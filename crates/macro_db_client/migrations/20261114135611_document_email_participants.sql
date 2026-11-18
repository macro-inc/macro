SET LOCAL lock_timeout = '5s';

-- Who sent or received each email attachment document: one row per document
-- and lowercased participant address, so a CRM record's Files tab can start
-- from the record's addresses and domains instead of the caller's access.
-- Inserts keep it a superset of the attachment chain (document_email ->
-- email_attachments -> email_messages -> sender and recipients ->
-- email_contacts); readers recheck the chain, so rows the chain no longer
-- proves are harmless and are not deleted.
--
-- No foreign key to "Document": a hard delete racing a backfill batch or a
-- sync trigger would fail that statement's check. Deleting documents deletes
-- their rows (documents_deleted below); a row a racing insert writes for a
-- document deleted meanwhile stays, and readers join "Document", so it only
-- costs space.
CREATE TABLE document_email_participants (
    document_id TEXT NOT NULL,
    address     TEXT NOT NULL,
    PRIMARY KEY (document_id, address)
);

-- Records the participants of every document linked to these attachments.
CREATE FUNCTION record_document_email_participants(attachment_ids uuid[]) RETURNS void
LANGUAGE sql AS $$
    INSERT INTO document_email_participants (document_id, address)
    SELECT de.document_id, LOWER(c.email_address)
    FROM document_email de
    JOIN email_attachments ea ON ea.id = de.email_attachment_id
    JOIN email_messages m ON m.id = ea.message_id
    CROSS JOIN LATERAL (
        SELECT m.from_contact_id AS contact_id
        UNION ALL
        SELECT r.contact_id FROM email_message_recipients r WHERE r.message_id = m.id
    ) participant
    JOIN email_contacts c ON c.id = participant.contact_id
    WHERE de.email_attachment_id = ANY(attachment_ids)
    ON CONFLICT DO NOTHING
$$;

-- Two writes in concurrent transactions can complete one chain between them
-- (a link and a new recipient of its message), and neither trigger would see
-- the other's uncommitted row. So every pair of such writes takes conflicting
-- row locks, and the trigger of whichever waits records after the other
-- commits: each statement of these volatile functions reads a fresh snapshot.
-- The rows they meet on:
--   * the attachment: a link's foreign key check and the KEY SHARE below
--     conflict with moving it, since message_id is a key column
--     (email_uq_attachments_message_id_provider_attachment_id);
--   * the message: FOR UPDATE below conflicts with a sender change, a new
--     recipient's foreign key check, and recipient_changed's KEY SHARE;
--   * each participant contact: KEY SHARE below, and the foreign key checks
--     of a new sender or recipient, conflict with changing its address, a key
--     column (contacts_link_id_email_address_idx).
--
-- Every writer takes a message before its attachments: deleting a message
-- (its cascade), sync's attachment refresh (after its message upsert),
-- adopting a sent message (the delivery's completion locks the local message,
-- then sent_identity's imported_message the imported one), a mailbox purge
-- batch (links::delete::delete_message_attachments locks its messages
-- first), and a link (lock_linked_message, before the foreign key check takes
-- the attachment). A link holding its attachment while it waited for the
-- message would deadlock with a writer holding the message that then deletes
-- or moves the attachment. Updating a link or moving an attachment locks that
-- row before any trigger runs, so a writer doing either locks the messages
-- first.
--
-- Locks a link or a moved attachment's chain from the attachment down, in
-- id order, then records it.
CREATE FUNCTION lock_and_record_document_email_participants(attachment_ids uuid[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM 1 FROM email_attachments WHERE id = ANY(attachment_ids) ORDER BY id FOR KEY SHARE;
    PERFORM 1 FROM email_messages
    WHERE id IN (SELECT message_id FROM email_attachments WHERE id = ANY(attachment_ids))
    ORDER BY id FOR UPDATE;
    PERFORM 1 FROM email_contacts
    WHERE id IN (
        SELECT m.from_contact_id
        FROM email_attachments ea JOIN email_messages m ON m.id = ea.message_id
        WHERE ea.id = ANY(attachment_ids)
        UNION
        SELECT r.contact_id
        FROM email_attachments ea JOIN email_message_recipients r ON r.message_id = ea.message_id
        WHERE ea.id = ANY(attachment_ids)
    )
    ORDER BY id FOR KEY SHARE;
    PERFORM record_document_email_participants(attachment_ids);
END $$;

-- Locks a new link's message before its foreign key check locks the
-- attachment. Reads the attachment again after each lock, until the message
-- it locked is still the attachment's: a move that committed meanwhile left
-- it on another message. A missing attachment fails the foreign key check.
CREATE FUNCTION document_email_participants_lock_linked_message() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    locked_message uuid;
    attachment_message uuid;
BEGIN
    SELECT message_id INTO attachment_message
    FROM email_attachments WHERE id = NEW.email_attachment_id;
    WHILE attachment_message IS DISTINCT FROM locked_message LOOP
        PERFORM 1 FROM email_messages WHERE id = attachment_message FOR UPDATE;
        locked_message := attachment_message;
        SELECT message_id INTO attachment_message
        FROM email_attachments WHERE id = NEW.email_attachment_id;
    END LOOP;
    RETURN NEW;
END $$;

CREATE FUNCTION document_email_participants_linked() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM lock_and_record_document_email_participants(
        ARRAY(SELECT DISTINCT email_attachment_id FROM linked)
    );
    RETURN NULL;
END $$;

CREATE FUNCTION document_email_participants_link_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM lock_and_record_document_email_participants(ARRAY[NEW.email_attachment_id]);
    RETURN NULL;
END $$;

CREATE FUNCTION document_email_participants_attachment_moved() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM lock_and_record_document_email_participants(ARRAY[NEW.id]);
    RETURN NULL;
END $$;

-- A sender change locks its message by updating it, and its new contact
-- through the foreign key check.
CREATE FUNCTION document_email_participants_sender_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM record_document_email_participants(
        ARRAY(SELECT ea.id FROM email_attachments ea WHERE ea.message_id = NEW.id)
    );
    RETURN NULL;
END $$;

-- New recipients lock their message and contact through the foreign key
-- checks, which run before this statement trigger. Most messages have no
-- attachment yet when sync writes their recipients, so skip the insert then.
-- The messages are collected into an array, so the cached plan probes the
-- attachments' message_id index whatever the size of the first statement.
CREATE FUNCTION document_email_participants_recipients_added() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    attachment_ids uuid[];
BEGIN
    attachment_ids := ARRAY(
        SELECT ea.id FROM email_attachments ea
        WHERE ea.message_id = ANY(ARRAY(SELECT DISTINCT message_id FROM added))
    );
    IF cardinality(attachment_ids) > 0 THEN
        PERFORM record_document_email_participants(attachment_ids);
    END IF;
    RETURN NULL;
END $$;

-- The foreign key check skips a message_id that did not change, so lock the
-- message here.
CREATE FUNCTION document_email_participants_recipient_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM 1 FROM email_messages WHERE id = NEW.message_id FOR KEY SHARE;
    PERFORM record_document_email_participants(
        ARRAY(SELECT ea.id FROM email_attachments ea WHERE ea.message_id = NEW.message_id)
    );
    RETURN NULL;
END $$;

-- Changing an address locks its contact FOR UPDATE, as a key update.
CREATE FUNCTION document_email_participants_address_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM record_document_email_participants(ARRAY(
        SELECT ea.id FROM email_attachments ea
        WHERE ea.message_id IN (
            SELECT m.id FROM email_messages m WHERE m.from_contact_id = NEW.id
            UNION
            SELECT r.message_id FROM email_message_recipients r WHERE r.contact_id = NEW.id
        )
    ));
    RETURN NULL;
END $$;

-- Deletes the rows of deleted documents, probing the primary key per id
-- (an array, like recipients_added, whatever the first statement's size).
CREATE FUNCTION document_email_participants_documents_deleted() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM document_email_participants
    WHERE document_id = ANY(ARRAY(SELECT id FROM deleted));
    RETURN NULL;
END $$;

CREATE TRIGGER document_email_participants_lock_linked_message
    BEFORE INSERT ON document_email
    FOR EACH ROW EXECUTE FUNCTION document_email_participants_lock_linked_message();

CREATE TRIGGER document_email_participants_linked
    AFTER INSERT ON document_email
    REFERENCING NEW TABLE AS linked
    FOR EACH STATEMENT EXECUTE FUNCTION document_email_participants_linked();

CREATE TRIGGER document_email_participants_link_changed
    AFTER UPDATE ON document_email
    FOR EACH ROW EXECUTE FUNCTION document_email_participants_link_changed();

CREATE TRIGGER document_email_participants_attachment_moved
    AFTER UPDATE OF message_id ON email_attachments
    FOR EACH ROW WHEN (NEW.message_id IS DISTINCT FROM OLD.message_id)
    EXECUTE FUNCTION document_email_participants_attachment_moved();

CREATE TRIGGER document_email_participants_recipients_added
    AFTER INSERT ON email_message_recipients
    REFERENCING NEW TABLE AS added
    FOR EACH STATEMENT EXECUTE FUNCTION document_email_participants_recipients_added();

CREATE TRIGGER document_email_participants_recipient_changed
    AFTER UPDATE OF message_id, contact_id ON email_message_recipients
    FOR EACH ROW
    WHEN (NEW.message_id IS DISTINCT FROM OLD.message_id OR NEW.contact_id IS DISTINCT FROM OLD.contact_id)
    EXECUTE FUNCTION document_email_participants_recipient_changed();

CREATE TRIGGER document_email_participants_sender_changed
    AFTER UPDATE OF from_contact_id ON email_messages
    FOR EACH ROW
    WHEN (NEW.from_contact_id IS NOT NULL AND NEW.from_contact_id IS DISTINCT FROM OLD.from_contact_id)
    EXECUTE FUNCTION document_email_participants_sender_changed();

CREATE TRIGGER document_email_participants_address_changed
    AFTER UPDATE OF email_address ON email_contacts
    FOR EACH ROW WHEN (LOWER(NEW.email_address) IS DISTINCT FROM LOWER(OLD.email_address))
    EXECUTE FUNCTION document_email_participants_address_changed();

CREATE TRIGGER document_email_participants_documents_deleted
    AFTER DELETE ON "Document"
    REFERENCING OLD TABLE AS deleted
    FOR EACH STATEMENT EXECUTE FUNCTION document_email_participants_documents_deleted();
