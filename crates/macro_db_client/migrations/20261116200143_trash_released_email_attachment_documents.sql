-- An email attachment imported into Drive is marked as one only by its
-- document_email row, and that row goes with its attachment, which goes with
-- its message, thread and inbox: a message deleted at the provider, a draft
-- saved again or sent, an inbox disconnected or removed. The document stays,
-- and without the row Drive lists it as an ordinary file. Several of those
-- paths delete through cascades from email_links, so the hook lives on the
-- link row rather than on each path.
--
-- When a statement removes links of documents, the trigger records each of
-- those documents in released_email_attachment_documents and notifies
-- email_attachment_documents_released. Document storage drains that queue: a
-- document with no link left goes to the Trash unless its owner adopted it or
-- it is there already, re-checking everything at that time, and every one
-- without a link is reported as no longer an email attachment. Documents
-- already in the Trash are queued too: search stops treating them as
-- attachments, so a later restore brings back a plain file. The trigger does not skip documents that still look linked: two
-- transactions removing a document's last two links each still see the
-- other's, so only the worker, after both commit, can tell. A document already
-- queued is touched rather than skipped: the row lock its update takes keeps
-- the worker's SKIP LOCKED claim off it until this transaction commits, so the
-- worker never decides about a document while one of its links is still being
-- deleted. The trigger is statement-level, so a statement that removes many
-- links, cascades included, records them in one insert and sends one
-- notification.
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
        -- A purge deletes the document in the same statement, so it is gone
        -- here and not queued. The transition table has no statistics.
        -- Without the OFFSET fence a statement releasing many links under
        -- stale statistics on "Document" hashed the whole table; fenced, the
        -- check is a probe per id. Rows go in id order: DO UPDATE locks the
        -- queue rows it touches, and two statements touching them in different
        -- orders could deadlock.
        INSERT INTO released_email_attachment_documents (document_id)
        SELECT DISTINCT released.document_id
        FROM released_links released
        WHERE EXISTS (
                SELECT 1
                FROM "Document" d
                WHERE d.id = released.document_id
                OFFSET 0
            )
        ORDER BY released.document_id
        ON CONFLICT (document_id) DO UPDATE SET released_at = EXCLUDED.released_at;

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
