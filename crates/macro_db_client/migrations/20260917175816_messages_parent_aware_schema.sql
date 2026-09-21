-- Additive, parent-aware schema for comms_messages. Nothing is dropped or renamed;
-- channel_id stays until every writer has moved to the parent columns.

ALTER TABLE comms_messages
    ADD COLUMN parent_entity_type text,
    ADD COLUMN parent_entity_id text,
    ADD COLUMN imported_author text,
    ADD COLUMN import_metadata jsonb,
    ADD COLUMN import_order bigint;

UPDATE comms_messages
SET parent_entity_type = 'channel',
    parent_entity_id = channel_id::text;

ALTER TABLE comms_messages
    ALTER COLUMN parent_entity_type SET NOT NULL,
    ALTER COLUMN parent_entity_id SET NOT NULL,
    ALTER COLUMN channel_id DROP NOT NULL,
    ADD CONSTRAINT comms_messages_parent_type_check
        CHECK (parent_entity_type IN ('channel', 'document')),
    ADD CONSTRAINT comms_messages_parent_id_check
        CHECK (length(parent_entity_id) > 0),
    ADD CONSTRAINT comms_messages_channel_parent_check
        CHECK ((parent_entity_type = 'channel') = (channel_id IS NOT NULL)),
    ADD CONSTRAINT comms_messages_parent_identity
        UNIQUE (id, parent_entity_type, parent_entity_id);

-- Transition shim. Deployed channel writers only set channel_id and the new
-- messages crate only sets the parent columns; keep the two representations of
-- a channel parent in step on insert. Delete this trigger together with
-- channel_id in the last PR of the stack.
CREATE FUNCTION sync_comms_message_parent() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.channel_id IS NOT NULL THEN
        IF NEW.parent_entity_type IS NULL THEN
            NEW.parent_entity_type := 'channel';
        END IF;
        IF NEW.parent_entity_type = 'channel' THEN
            IF NEW.parent_entity_id IS NULL THEN
                NEW.parent_entity_id := NEW.channel_id::text;
            ELSIF NEW.parent_entity_id <> NEW.channel_id::text THEN
                RAISE EXCEPTION 'comms_messages % has channel_id % but parent_entity_id %',
                    NEW.id, NEW.channel_id, NEW.parent_entity_id
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;
    ELSIF NEW.parent_entity_type = 'channel' AND NEW.parent_entity_id IS NOT NULL THEN
        NEW.channel_id := NEW.parent_entity_id::uuid;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_comms_message_parent
BEFORE INSERT ON comms_messages
FOR EACH ROW
EXECUTE FUNCTION sync_comms_message_parent();

ALTER TABLE comms_messages
    DROP CONSTRAINT comms_messages_thread_id_fkey,
    ADD CONSTRAINT comms_messages_thread_parent_fkey
        FOREIGN KEY (thread_id, parent_entity_type, parent_entity_id)
        REFERENCES comms_messages (id, parent_entity_type, parent_entity_id)
        ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE comms_message_threads (
    root_id uuid PRIMARY KEY,
    parent_entity_type text NOT NULL,
    parent_entity_id text NOT NULL,
    user_id text NOT NULL,
    resolved boolean NOT NULL DEFAULT false,
    anchor jsonb,
    import_metadata jsonb,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    deleted_at timestamptz,
    CONSTRAINT comms_message_threads_root_fkey
        FOREIGN KEY (root_id, parent_entity_type, parent_entity_id)
        REFERENCES comms_messages (id, parent_entity_type, parent_entity_id)
        ON DELETE CASCADE,
    CONSTRAINT comms_message_threads_anchor_parent_check
        CHECK (anchor IS NULL OR parent_entity_type = 'document'),
    CONSTRAINT comms_message_threads_anchor_check CHECK (
        anchor IS NULL OR (
            jsonb_typeof(anchor) = 'object'
            AND anchor->>'type' IN ('markdown', 'pdf_highlight', 'pdf_placeable')
        )
    )
);

CREATE UNIQUE INDEX idx_comms_message_threads_markdown_mark
    ON comms_message_threads (parent_entity_id, (anchor->>'mark_id'))
    WHERE anchor->>'type' = 'markdown' AND deleted_at IS NULL;

CREATE INDEX idx_comms_message_threads_parent
    ON comms_message_threads (parent_entity_type, parent_entity_id);

INSERT INTO comms_message_threads (
    root_id, parent_entity_type, parent_entity_id, user_id, created_at, updated_at
)
SELECT id, parent_entity_type, parent_entity_id, sender_id, created_at, updated_at
FROM comms_messages
WHERE thread_id IS NULL;

-- Structural bookkeeping: every root message owns one thread row, and today's
-- channel writers know nothing about the table.
CREATE FUNCTION initialize_comms_message_thread() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.thread_id IS NULL THEN
        INSERT INTO comms_message_threads (
            root_id, parent_entity_type, parent_entity_id, user_id, created_at, updated_at
        )
        VALUES (
            NEW.id, NEW.parent_entity_type, NEW.parent_entity_id,
            NEW.sender_id, NEW.created_at, NEW.updated_at
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_initialize_comms_message_thread
AFTER INSERT ON comms_messages
FOR EACH ROW
EXECUTE FUNCTION initialize_comms_message_thread();

-- Immutable legacy-id mappings for the comment import. Their FKs to the message
-- tables are added once the import has written rows.
CREATE TABLE migrated_comment_id (
    comment_id bigint PRIMARY KEY,
    message_id uuid NOT NULL UNIQUE,
    document_id text NOT NULL REFERENCES "Document" (id) ON DELETE CASCADE
);

CREATE TABLE migrated_comment_thread_id (
    thread_id bigint PRIMARY KEY,
    root_id uuid NOT NULL UNIQUE,
    document_id text NOT NULL REFERENCES "Document" (id) ON DELETE CASCADE
);

CREATE INDEX idx_comms_messages_parent_timeline
    ON comms_messages (parent_entity_type, parent_entity_id, created_at, id)
    WHERE thread_id IS NULL;

CREATE INDEX idx_comms_messages_parent_history
    ON comms_messages (parent_entity_type, parent_entity_id, created_at DESC, id DESC);

CREATE INDEX idx_comms_messages_parent_activity
    ON comms_messages (parent_entity_type, parent_entity_id, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_comms_messages_thread_order
    ON comms_messages (thread_id, import_order, created_at, id)
    WHERE thread_id IS NOT NULL;

-- New document discussions attach to PDF anchors by root. Legacy anchors keep
-- their "threadId" until the import fills root_id from the mapping tables.
ALTER TABLE "PdfPlaceableCommentAnchor"
    ADD COLUMN root_id uuid REFERENCES comms_message_threads (root_id) ON DELETE CASCADE;

CREATE INDEX "PdfPlaceableCommentAnchor_root_id_idx"
    ON "PdfPlaceableCommentAnchor" (root_id)
    WHERE root_id IS NOT NULL;

ALTER TABLE "PdfHighlightAnchor"
    ADD COLUMN root_id uuid REFERENCES comms_message_threads (root_id) ON DELETE SET NULL;

CREATE INDEX "PdfHighlightAnchor_root_id_idx"
    ON "PdfHighlightAnchor" (root_id)
    WHERE root_id IS NOT NULL;
