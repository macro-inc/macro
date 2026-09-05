-- Run the two message migrations through the message cutover command while
-- writers are stopped. The command fills UUIDv7 mappings between migrations.
ALTER TABLE comms_messages
    ADD COLUMN parent_entity_type text,
    ADD COLUMN parent_entity_id text,
    ADD COLUMN imported_author text,
    ADD COLUMN import_metadata jsonb,
    ADD COLUMN import_order bigint,
    ALTER COLUMN channel_id DROP NOT NULL;

UPDATE comms_messages
SET parent_entity_type = 'channel', parent_entity_id = channel_id::text;

ALTER TABLE comms_messages
    ALTER COLUMN parent_entity_type SET NOT NULL,
    ALTER COLUMN parent_entity_id SET NOT NULL,
    ADD CONSTRAINT comms_messages_parent_type_check
        CHECK (parent_entity_type IN ('channel', 'document', 'email_thread')),
    ADD CONSTRAINT comms_messages_parent_id_check CHECK (length(parent_entity_id) > 0),
    ADD CONSTRAINT comms_messages_parent_identity UNIQUE (id, parent_entity_type, parent_entity_id);

CREATE TABLE comms_message_threads (
    root_id uuid PRIMARY KEY REFERENCES comms_messages(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    resolved boolean NOT NULL DEFAULT false,
    anchor jsonb,
    import_metadata jsonb,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    deleted_at timestamptz,
    CONSTRAINT comms_message_threads_anchor_check CHECK (
        anchor IS NULL OR (
            jsonb_typeof(anchor) = 'object'
            AND anchor->>'type' IN ('markdown', 'pdf_highlight', 'pdf_placeable')
        )
    )
);

INSERT INTO comms_message_threads (root_id, user_id, created_at, updated_at)
SELECT id, sender_id, created_at, updated_at FROM comms_messages WHERE thread_id IS NULL;

-- These immutable mappings preserve links already delivered outside our control.
-- UUIDs are allocated by the application using macro_uuid, including empty roots.
CREATE TABLE migrated_comment_id (
    comment_id bigint PRIMARY KEY,
    message_id uuid NOT NULL UNIQUE,
    document_id text NOT NULL REFERENCES "Document"(id) ON DELETE CASCADE
);
CREATE TABLE migrated_comment_thread_id (
    thread_id bigint PRIMARY KEY,
    root_id uuid NOT NULL UNIQUE,
    document_id text NOT NULL REFERENCES "Document"(id) ON DELETE CASCADE
);
