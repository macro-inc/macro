CREATE EXTENSION IF NOT EXISTS btree_gin;

CREATE TABLE email_contact_search_index (
    link_id UUID NOT NULL,
    thread_id UUID NOT NULL,
    message_id UUID NOT NULL,
    contact_name TEXT,
    contact_email TEXT NOT NULL,
    contact_type TEXT NOT NULL,
    CONSTRAINT ecsi_unique UNIQUE (message_id, contact_email, contact_type)
);

CREATE INDEX idx_ecsi_link_name_trgm
    ON email_contact_search_index USING gin (link_id, contact_name gin_trgm_ops);

CREATE INDEX idx_ecsi_link_email_trgm
    ON email_contact_search_index USING gin (link_id, contact_email gin_trgm_ops);

-- Triggers first so any new data between this migration and backfill is captured

-- Trigger: populate FROM contact when a message is inserted/updated
CREATE OR REPLACE FUNCTION ecsi_populate_from()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.from_contact_id IS NOT NULL THEN
        INSERT INTO email_contact_search_index
            (link_id, thread_id, message_id, contact_name, contact_email, contact_type)
        SELECT NEW.link_id, NEW.thread_id, NEW.id,
               COALESCE(NEW.from_name, c.name), c.email_address, 'FROM'
        FROM email_contacts c
        WHERE c.id = NEW.from_contact_id
        ON CONFLICT (message_id, contact_email, contact_type) DO UPDATE SET
            contact_name = EXCLUDED.contact_name;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ecsi_message_from
    AFTER INSERT OR UPDATE OF from_contact_id, from_name ON email_messages
    FOR EACH ROW
    EXECUTE FUNCTION ecsi_populate_from();

-- Trigger: populate recipient contacts when recipients are inserted
CREATE OR REPLACE FUNCTION ecsi_populate_recipient()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO email_contact_search_index
        (link_id, thread_id, message_id, contact_name, contact_email, contact_type)
    SELECT m.link_id, m.thread_id, m.id,
           COALESCE(NEW.name, c.name), c.email_address, NEW.recipient_type::text
    FROM email_messages m
    JOIN email_contacts c ON c.id = NEW.contact_id
    WHERE m.id = NEW.message_id
    ON CONFLICT (message_id, contact_email, contact_type) DO UPDATE SET
        contact_name = EXCLUDED.contact_name;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ecsi_message_recipient
    AFTER INSERT ON email_message_recipients
    FOR EACH ROW
    EXECUTE FUNCTION ecsi_populate_recipient();

-- Trigger: remove recipient entries when recipients are deleted
CREATE OR REPLACE FUNCTION ecsi_delete_recipient()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM email_contact_search_index
    WHERE message_id = OLD.message_id
      AND contact_type = OLD.recipient_type::text
      AND contact_email = (SELECT email_address FROM email_contacts WHERE id = OLD.contact_id);
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ecsi_message_recipient_delete
    AFTER DELETE ON email_message_recipients
    FOR EACH ROW
    EXECUTE FUNCTION ecsi_delete_recipient();

-- Trigger: cascade message deletion to index
CREATE OR REPLACE FUNCTION ecsi_delete_message()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM email_contact_search_index WHERE message_id = OLD.id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ecsi_message_delete
    AFTER DELETE ON email_messages
    FOR EACH ROW
    EXECUTE FUNCTION ecsi_delete_message();

-- Trigger: propagate contact name updates to index
CREATE OR REPLACE FUNCTION ecsi_update_contact_name()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE email_contact_search_index idx
    SET contact_name = NEW.name
    FROM email_messages m
    WHERE idx.message_id = m.id
      AND idx.contact_type = 'FROM'
      AND m.from_contact_id = NEW.id
      AND m.from_name IS NULL;

    UPDATE email_contact_search_index idx
    SET contact_name = NEW.name
    FROM email_message_recipients mr
    JOIN email_messages m ON m.id = mr.message_id
    WHERE idx.message_id = mr.message_id
      AND idx.contact_type = mr.recipient_type::text
      AND mr.contact_id = NEW.id
      AND mr.name IS NULL;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ecsi_contact_name_update
    AFTER UPDATE OF name ON email_contacts
    FOR EACH ROW
    WHEN (OLD.name IS DISTINCT FROM NEW.name)
    EXECUTE FUNCTION ecsi_update_contact_name();
