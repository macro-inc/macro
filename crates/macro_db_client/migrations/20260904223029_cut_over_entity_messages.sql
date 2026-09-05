-- A single coordinated cutover: no old writers may run between the prepare and
-- cutover migrations. Fresh installations have no legacy rows to map.
SET LOCAL TIME ZONE 'UTC';
LOCK TABLE "Comment", "Thread", comms_messages IN ACCESS EXCLUSIVE MODE;

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM "Comment" c LEFT JOIN migrated_comment_id m ON m.comment_id = c.id
        WHERE m.message_id IS NULL
    ) OR EXISTS (
        SELECT 1 FROM "Thread" t LEFT JOIN migrated_comment_thread_id m ON m.thread_id = t.id
        WHERE m.root_id IS NULL
    ) THEN
        RAISE EXCEPTION 'Run the message cutover UUID mapping command before this migration';
    END IF;
    IF EXISTS (
        SELECT t.id FROM "Thread" t
        LEFT JOIN "PdfPlaceableCommentAnchor" p ON p."threadId" = t.id
        LEFT JOIN "PdfHighlightAnchor" h ON h."threadId" = t.id
        GROUP BY t.id HAVING count(DISTINCT p.uuid) + count(DISTINCT h.uuid) > 1
    ) THEN
        RAISE EXCEPTION 'A legacy thread has multiple PDF anchors; resolve ambiguous anchors before cutover';
    END IF;
END $$;

INSERT INTO comms_messages (
    id, parent_entity_type, parent_entity_id, thread_id, sender_id, imported_author,
    content, created_at, updated_at, edited_at, deleted_at, import_metadata, import_order
)
SELECT cm.message_id, 'document', t."documentId",
    CASE WHEN cm.message_id = tm.root_id THEN NULL ELSE tm.root_id END,
    c.owner, c.sender, c.text, c."createdAt", c."updatedAt",
    CASE WHEN c."updatedAt" > c."createdAt" THEN c."updatedAt" END,
    COALESCE(c."deletedAt", t."deletedAt"), c.metadata,
    row_number() OVER (PARTITION BY t.id ORDER BY c."order" NULLS LAST, c."createdAt", c.id)
FROM "Comment" c
JOIN "Thread" t ON t.id = c."threadId"
JOIN migrated_comment_id cm ON cm.comment_id = c.id AND cm.document_id = t."documentId"
JOIN migrated_comment_thread_id tm ON tm.thread_id = t.id AND tm.document_id = t."documentId";

-- Empty historical threads retain a structural tombstone so their identity,
-- resolution, anchors, and external links remain representable.
INSERT INTO comms_messages (
    id, parent_entity_type, parent_entity_id, sender_id,
    content, created_at, updated_at, deleted_at
)
SELECT tm.root_id, 'document', t."documentId", t.owner, '',
    t."createdAt", t."updatedAt", COALESCE(t."deletedAt", t."updatedAt")
FROM "Thread" t JOIN migrated_comment_thread_id tm ON tm.thread_id = t.id
WHERE NOT EXISTS (SELECT 1 FROM "Comment" c WHERE c."threadId" = t.id);

INSERT INTO comms_message_threads (
    root_id, user_id, resolved, anchor, import_metadata, created_at, updated_at, deleted_at
)
SELECT tm.root_id, t.owner, t.resolved,
    CASE
        WHEN pa.uuid IS NOT NULL THEN jsonb_build_object('type', 'pdf_placeable', 'anchor_id', pa.uuid)
        WHEN ph.uuid IS NOT NULL THEN jsonb_build_object('type', 'pdf_highlight', 'anchor_id', ph.uuid)
        WHEN t.metadata->>'markId' IS NOT NULL AND t.metadata->>'markId' NOT LIKE 'DISCUSSION:%'
            THEN jsonb_build_object('type', 'markdown', 'mark_id', (t.metadata->>'markId')::uuid)
        ELSE NULL
    END,
    t.metadata, t."createdAt", t."updatedAt", t."deletedAt"
FROM "Thread" t
JOIN migrated_comment_thread_id tm ON tm.thread_id = t.id
LEFT JOIN "PdfPlaceableCommentAnchor" pa ON pa."threadId" = t.id
LEFT JOIN "PdfHighlightAnchor" ph ON ph."threadId" = t.id;

-- Validate before removing any source data.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM comms_message_threads t JOIN comms_messages m ON m.id = t.root_id
        WHERE t.deleted_at IS NULL AND t.anchor->>'type' = 'markdown'
        GROUP BY m.parent_entity_type, m.parent_entity_id, t.anchor->>'mark_id' HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'Multiple active discussions have the same Markdown mark ID';
    END IF;
    IF (SELECT count(*) FROM "Comment") <> (
        SELECT count(*) FROM migrated_comment_id cm JOIN comms_messages m ON m.id = cm.message_id
    ) OR (SELECT count(*) FROM "Thread") <> (
        SELECT count(*) FROM migrated_comment_thread_id tm JOIN comms_message_threads t ON t.root_id = tm.root_id
    ) THEN
        RAISE EXCEPTION 'Message migration row counts do not match';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "Comment" c JOIN migrated_comment_id cm ON cm.comment_id = c.id
        JOIN comms_messages m ON m.id = cm.message_id
        WHERE m.content IS DISTINCT FROM c.text OR m.sender_id IS DISTINCT FROM c.owner
            OR m.imported_author IS DISTINCT FROM c.sender
            OR m.created_at IS DISTINCT FROM c."createdAt"::timestamptz
    ) THEN
        RAISE EXCEPTION 'Message migration changed content, attribution, or creation time';
    END IF;
END $$;

ALTER TABLE "PdfPlaceableCommentAnchor" DROP CONSTRAINT "PdfPlaceableCommentAnchor_threadId_fkey";
ALTER TABLE "PdfHighlightAnchor" DROP CONSTRAINT "PdfHighlightAnchor_threadId_fkey";
ALTER TABLE "PdfPlaceableCommentAnchor" ADD COLUMN root_id uuid;
ALTER TABLE "PdfHighlightAnchor" ADD COLUMN root_id uuid;
UPDATE "PdfPlaceableCommentAnchor" a SET root_id = m.root_id
FROM migrated_comment_thread_id m WHERE a."threadId" = m.thread_id;
UPDATE "PdfHighlightAnchor" a SET root_id = m.root_id
FROM migrated_comment_thread_id m WHERE a."threadId" = m.thread_id;
ALTER TABLE "PdfPlaceableCommentAnchor" DROP COLUMN "threadId";
ALTER TABLE "PdfHighlightAnchor" DROP COLUMN "threadId";
ALTER TABLE "PdfPlaceableCommentAnchor" RENAME COLUMN root_id TO "threadId";
ALTER TABLE "PdfHighlightAnchor" RENAME COLUMN root_id TO "threadId";
ALTER TABLE "PdfPlaceableCommentAnchor"
    ALTER COLUMN "threadId" SET NOT NULL,
    ADD FOREIGN KEY ("threadId") REFERENCES comms_message_threads(root_id) ON DELETE CASCADE;
ALTER TABLE "PdfHighlightAnchor"
    ADD FOREIGN KEY ("threadId") REFERENCES comms_message_threads(root_id) ON DELETE SET NULL;

UPDATE notification n SET metadata = jsonb_set(
    jsonb_set(n.metadata, '{commentId}', to_jsonb(cm.message_id::text)),
    '{threadId}', to_jsonb(tm.root_id::text)
)
FROM migrated_comment_id cm, migrated_comment_thread_id tm
WHERE n.notification_event_type IN (
    'commented_on_document', 'replied_to_document_comment_thread', 'mentioned_in_document_comment'
)
AND n.metadata->>'commentId' = cm.comment_id::text
AND n.metadata->>'threadId' = tm.thread_id::text
AND cm.document_id = tm.document_id AND n.event_item_id = cm.document_id;

-- Saved PDF export payloads are relational metadata. Rewrite their application
-- comment IDs in this same transaction; Markdown/Loro documents are untouched.
CREATE FUNCTION pg_temp.remap_pdf_comment_ids(value jsonb, document_id text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb; item jsonb; key text; child jsonb; mapped uuid;
BEGIN
    IF jsonb_typeof(value) = 'array' THEN
        SELECT COALESCE(jsonb_agg(pg_temp.remap_pdf_comment_ids(entry, document_id) ORDER BY ordinal), '[]'::jsonb)
        INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS elements(entry, ordinal);
        RETURN result;
    ELSIF jsonb_typeof(value) <> 'object' THEN RETURN value;
    END IF;
    result := '{}'::jsonb;
    FOR key, child IN SELECT * FROM jsonb_each(value) LOOP
        IF key = 'comments' AND jsonb_typeof(child) = 'array' THEN
            result := result || jsonb_build_object(key, '[]'::jsonb);
            FOR item IN SELECT * FROM jsonb_array_elements(child) LOOP
                IF item->>'id' ~ '^[0-9]+$' THEN
                    SELECT m.message_id INTO mapped FROM migrated_comment_id m
                    WHERE m.comment_id::text = item->>'id' AND m.document_id = remap_pdf_comment_ids.document_id;
                    IF mapped IS NULL THEN RAISE EXCEPTION 'Unmapped saved PDF comment % in document %', item->>'id', document_id; END IF;
                    item := jsonb_set(item, '{id}', to_jsonb(mapped::text));
                END IF;
                result := jsonb_set(result, ARRAY[key], (result->key) || jsonb_build_array(item));
            END LOOP;
        ELSE result := result || jsonb_build_object(key, pg_temp.remap_pdf_comment_ids(child, document_id));
        END IF;
    END LOOP;
    RETURN result;
END $$;
UPDATE "DocumentInstanceModificationData" m
SET "modificationData" = pg_temp.remap_pdf_comment_ids(m."modificationData", i."documentId")
FROM "DocumentInstance" i JOIN "Document" d ON d.id = i."documentId"
WHERE m."documentInstanceId" = i.id AND d."fileType" = 'pdf';

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM notification n WHERE n.notification_event_type IN (
        'commented_on_document', 'replied_to_document_comment_thread', 'mentioned_in_document_comment'
    ) AND (COALESCE(n.metadata->>'commentId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR COALESCE(n.metadata->>'threadId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) THEN
        RAISE EXCEPTION 'Unmapped historical comment notifications must be resolved before cutover';
    END IF;
END $$;

ALTER TABLE migrated_comment_id ADD FOREIGN KEY (message_id) REFERENCES comms_messages(id) ON DELETE CASCADE;
ALTER TABLE migrated_comment_thread_id ADD FOREIGN KEY (root_id) REFERENCES comms_message_threads(root_id) ON DELETE CASCADE;

DROP TABLE "ThreadAnchor";
DROP TABLE "Comment";
DROP TABLE "Thread";

ALTER TABLE comms_messages DROP COLUMN channel_id;
ALTER TABLE comms_attachments DROP COLUMN channel_id;
CREATE OR REPLACE FUNCTION cascade_comms_message_delete_to_notifications()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
        DELETE FROM notification
        WHERE event_item_type = NEW.parent_entity_type
          AND event_item_id = NEW.parent_entity_id
          AND (metadata->>'messageId' = NEW.id::text OR metadata->>'commentId' = NEW.id::text);
    END IF;
    RETURN NEW;
END $$;
ALTER TABLE comms_messages DROP CONSTRAINT comms_messages_thread_id_fkey;
ALTER TABLE comms_messages ADD CONSTRAINT comms_messages_thread_parent_fkey
    FOREIGN KEY (thread_id, parent_entity_type, parent_entity_id)
    REFERENCES comms_messages(id, parent_entity_type, parent_entity_id)
    ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX comms_messages_parent_timeline
    ON comms_messages(parent_entity_type, parent_entity_id, created_at, id)
    WHERE thread_id IS NULL;
CREATE INDEX comms_messages_parent_activity
    ON comms_messages(parent_entity_type, parent_entity_id, created_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX comms_messages_thread_order
    ON comms_messages(thread_id, import_order, created_at, id) WHERE thread_id IS NOT NULL;
CREATE INDEX comms_attachments_entity_created
    ON comms_attachments(entity_type, entity_id, created_at DESC) INCLUDE (message_id);

-- Channel read projections derive scope from the single message store. They
-- contain no duplicate messages and cannot accept channel_id writes.
CREATE VIEW comms_channel_messages AS
SELECT id, CASE WHEN parent_entity_type = 'channel' THEN parent_entity_id::uuid END AS channel_id, thread_id, sender_id, content,
    created_at, updated_at, edited_at, deleted_at, triggered_by_user_id
FROM comms_messages WHERE parent_entity_type = 'channel';
CREATE VIEW comms_channel_attachments AS
SELECT a.id, a.message_id, a.entity_type, a.entity_id, a.created_at, a.width, a.height,
    CASE WHEN m.parent_entity_type = 'channel' THEN m.parent_entity_id::uuid END AS channel_id
FROM comms_attachments a JOIN comms_messages m ON m.id = a.message_id
WHERE m.parent_entity_type = 'channel';

CREATE FUNCTION validate_message_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_found boolean; root_thread uuid; root_deleted timestamptz;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (NEW.parent_entity_type, NEW.parent_entity_id, NEW.thread_id, NEW.sender_id)
            IS DISTINCT FROM (OLD.parent_entity_type, OLD.parent_entity_id, OLD.thread_id, OLD.sender_id) THEN
            RAISE EXCEPTION 'message parent, root, and owner are immutable' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    CASE NEW.parent_entity_type
        WHEN 'channel' THEN
            SELECT true INTO parent_found FROM comms_channels
            WHERE id = NEW.parent_entity_id::uuid FOR SHARE;
        WHEN 'document' THEN
            SELECT true INTO parent_found FROM "Document"
            WHERE id = NEW.parent_entity_id AND "deletedAt" IS NULL FOR SHARE;
        WHEN 'email_thread' THEN
            SELECT true INTO parent_found FROM email_threads
            WHERE id = NEW.parent_entity_id::uuid FOR SHARE;
        ELSE RAISE EXCEPTION 'unsupported message parent' USING ERRCODE = '23514';
    END CASE;
    IF parent_found IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'message parent not found' USING ERRCODE = '23503';
    END IF;
    IF NEW.thread_id IS NOT NULL THEN
        SELECT m.thread_id, t.deleted_at INTO root_thread, root_deleted
        FROM comms_messages m JOIN comms_message_threads t ON t.root_id = m.id
        WHERE m.id = NEW.thread_id AND m.parent_entity_type = NEW.parent_entity_type
            AND m.parent_entity_id = NEW.parent_entity_id
        FOR UPDATE OF t;
        IF NOT FOUND OR root_thread IS NOT NULL OR root_deleted IS NOT NULL THEN
            RAISE EXCEPTION 'reply must reference an active root on the same parent' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER validate_message_parent BEFORE INSERT OR UPDATE ON comms_messages
    FOR EACH ROW EXECUTE FUNCTION validate_message_parent();

CREATE FUNCTION initialize_message_thread() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.thread_id IS NULL THEN
        INSERT INTO comms_message_threads(root_id, user_id, created_at, updated_at)
        VALUES (NEW.id, NEW.sender_id, NEW.created_at, NEW.updated_at);
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER initialize_message_thread AFTER INSERT ON comms_messages
    FOR EACH ROW EXECUTE FUNCTION initialize_message_thread();

CREATE FUNCTION validate_message_thread() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root_parent text; root_parent_id text; reply_to uuid; anchor_found boolean;
BEGIN
    SELECT parent_entity_type, parent_entity_id, thread_id INTO root_parent, root_parent_id, reply_to
    FROM comms_messages WHERE id = NEW.root_id;
    IF NOT FOUND OR reply_to IS NOT NULL THEN
        RAISE EXCEPTION 'thread state requires a root message' USING ERRCODE = '23514';
    END IF;
    IF NEW.anchor IS NOT NULL THEN
        IF root_parent <> 'document' THEN
            RAISE EXCEPTION 'anchors require a document parent' USING ERRCODE = '23514';
        END IF;
        CASE NEW.anchor->>'type'
            WHEN 'markdown' THEN
                IF NEW.deleted_at IS NULL THEN
                    PERFORM pg_advisory_xact_lock(hashtextextended(root_parent_id || ':' || (NEW.anchor->>'mark_id'), 0));
                    IF EXISTS (SELECT 1 FROM comms_message_threads t JOIN comms_messages m ON m.id = t.root_id
                        WHERE t.root_id <> NEW.root_id AND t.deleted_at IS NULL AND t.anchor->>'type' = 'markdown'
                            AND t.anchor->>'mark_id' = NEW.anchor->>'mark_id'
                            AND m.parent_entity_type = root_parent AND m.parent_entity_id = root_parent_id) THEN
                        RAISE EXCEPTION 'markdown mark already has a discussion' USING ERRCODE = '23514';
                    END IF;
                END IF;
                IF (NEW.anchor->>'mark_id')::uuid IS NULL THEN
                    RAISE EXCEPTION 'markdown anchor requires mark_id' USING ERRCODE = '23514';
                END IF;
            WHEN 'pdf_highlight' THEN
                SELECT true INTO anchor_found FROM "PdfHighlightAnchor"
                WHERE uuid = (NEW.anchor->>'anchor_id')::uuid AND "documentId" = root_parent_id
                    AND "threadId" = NEW.root_id;
            WHEN 'pdf_placeable' THEN
                SELECT true INTO anchor_found FROM "PdfPlaceableCommentAnchor"
                WHERE uuid = (NEW.anchor->>'anchor_id')::uuid AND "documentId" = root_parent_id
                    AND "threadId" = NEW.root_id;
            ELSE RAISE EXCEPTION 'unsupported thread anchor' USING ERRCODE = '23514';
        END CASE;
        IF NEW.anchor->>'type' <> 'markdown' AND anchor_found IS DISTINCT FROM true THEN
            RAISE EXCEPTION 'PDF anchor must belong to the same document and root' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER validate_message_thread
    AFTER INSERT OR UPDATE ON comms_message_threads DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION validate_message_thread();

CREATE FUNCTION delete_parent_messages() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    DELETE FROM comms_messages WHERE parent_entity_type = TG_ARGV[0] AND parent_entity_id = OLD.id::text;
    RETURN OLD;
END $$;
CREATE TRIGGER delete_document_messages AFTER DELETE ON "Document"
    FOR EACH ROW EXECUTE FUNCTION delete_parent_messages('document');
CREATE TRIGGER delete_channel_messages AFTER DELETE ON comms_channels
    FOR EACH ROW EXECUTE FUNCTION delete_parent_messages('channel');
CREATE TRIGGER delete_email_messages AFTER DELETE ON email_threads
    FOR EACH ROW EXECUTE FUNCTION delete_parent_messages('email_thread');
