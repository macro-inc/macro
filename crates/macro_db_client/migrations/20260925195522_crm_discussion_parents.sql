-- CRM companies and contacts become discussion parents. Each gets a generated
-- key with a real FK, so a discussion is deleted with its company or contact
-- on every hard-delete path, including contacts removed by their company's
-- cascade, and a message cannot be inserted against a record being deleted.
ALTER TABLE comms_messages
    DROP CONSTRAINT comms_messages_parent_type_check,
    ADD CONSTRAINT comms_messages_parent_type_check
        CHECK (parent_entity_type IN ('channel', 'document', 'crm_company', 'crm_contact')),
    ADD COLUMN crm_company_message_parent_id uuid GENERATED ALWAYS AS (
        CASE WHEN parent_entity_type = 'crm_company' THEN parent_entity_id::uuid END
    ) STORED REFERENCES crm_companies (id) ON DELETE CASCADE,
    ADD COLUMN crm_contact_message_parent_id uuid GENERATED ALWAYS AS (
        CASE WHEN parent_entity_type = 'crm_contact' THEN parent_entity_id::uuid END
    ) STORED REFERENCES crm_contacts (id) ON DELETE CASCADE;

CREATE INDEX idx_comms_messages_crm_company_parent
    ON comms_messages (crm_company_message_parent_id)
    WHERE crm_company_message_parent_id IS NOT NULL;

CREATE INDEX idx_comms_messages_crm_contact_parent
    ON comms_messages (crm_contact_message_parent_id)
    WHERE crm_contact_message_parent_id IS NOT NULL;

-- Mentions use a polymorphic source rather than a message FK, so remove their
-- message-owned rows when a parent cascade deletes messages.
CREATE FUNCTION cleanup_parent_message_mentions() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM comms_entity_mentions
    WHERE source_entity_type = 'message' AND source_entity_id = OLD.id::text;
    RETURN OLD;
END;
$$;

CREATE TRIGGER trg_cleanup_parent_message_mentions
AFTER DELETE ON comms_messages
FOR EACH ROW WHEN (OLD.parent_entity_type IN ('crm_company', 'crm_contact'))
EXECUTE FUNCTION cleanup_parent_message_mentions();
