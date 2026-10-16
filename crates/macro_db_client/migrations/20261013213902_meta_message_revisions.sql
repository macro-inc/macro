-- Revisions can precede the original message. They never create conversations,
-- send intents, or reply-window activity. Deletion permanently dominates edits.
CREATE TABLE meta_messaging_revision (
    connection_id uuid NOT NULL REFERENCES meta_messaging_connection(id) ON DELETE CASCADE,
    customer_id text NOT NULL,
    provider_message_id text NOT NULL,
    direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    edit_number bigint NOT NULL DEFAULT 0 CHECK (edit_number BETWEEN 0 AND 4294967295),
    content text CHECK (octet_length(content) <= 65536),
    edited_at timestamptz,
    deleted_at timestamptz,
    PRIMARY KEY (connection_id, customer_id, provider_message_id)
);
