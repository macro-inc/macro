-- An email attachment imported into Drive is marked as one only by its
-- document_email row, and that row goes with its attachment, which goes with
-- its message, thread and inbox: a message deleted at the provider, a draft
-- saved again or sent, an inbox disconnected or removed. The document stays,
-- and without the row Drive lists it as an ordinary file. Several of those
-- paths delete through cascades from email_links, so the hook lives on the
-- link row rather than on each path.
--
-- When a statement removes a live document's last link, the trigger records
-- the document in released_email_attachment_documents and notifies
-- email_attachment_documents_released. Document storage drains that queue and
-- moves each document to the Trash through the documents domain unless its
-- owner adopted it, re-checking everything at that time. The trigger is
-- statement-level, so a statement that removes many links, cascades included,
-- records them in one insert and sends one notification.
--
-- The queue is safe to fill before any worker drains it: ids wait.

SET LOCAL lock_timeout = '5s';

CREATE TABLE released_email_attachment_documents (
    document_id text PRIMARY KEY,
    released_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX released_email_attachment_documents_released_at
    ON released_email_attachment_documents (released_at);

CREATE FUNCTION enqueue_released_email_attachment_documents()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS
$$
    BEGIN
        -- The transition table has no statistics. Without the OFFSET fences a
        -- statement releasing many links under stale statistics on "Document"
        -- hashed every live document; fenced, each check is a probe per id.
        INSERT INTO released_email_attachment_documents (document_id)
        SELECT DISTINCT released.document_id
        FROM released_links released
        WHERE NOT EXISTS (
                SELECT 1
                FROM document_email de
                WHERE de.document_id = released.document_id
                OFFSET 0
            )
            AND EXISTS (
                SELECT 1
                FROM "Document" d
                WHERE d.id = released.document_id AND d."deletedAt" IS NULL
                OFFSET 0
            )
        ON CONFLICT (document_id) DO NOTHING;

        IF FOUND THEN
            PERFORM pg_notify('email_attachment_documents_released', '');
        END IF;

        RETURN NULL;
    END;
$$;

CREATE TRIGGER document_email_release
    AFTER DELETE ON document_email
    REFERENCING OLD TABLE AS released_links
    FOR EACH STATEMENT EXECUTE FUNCTION enqueue_released_email_attachment_documents();
