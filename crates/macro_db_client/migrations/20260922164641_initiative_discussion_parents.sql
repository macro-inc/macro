-- Keep the initial table lock brief: neither adding the nullable column nor
-- adding NOT VALID constraints rewrites or scans the existing message table.
SET LOCAL lock_timeout = '5s';

-- The previous validated parent-type check permits only channels/documents,
-- whose initiative key is NULL. No existing rows need a backfill. Install the
-- write trigger in this transaction before initiative parents become visible.
ALTER TABLE comms_messages
    DROP CONSTRAINT comms_messages_parent_type_check,
    ADD CONSTRAINT comms_messages_parent_type_check
        CHECK (parent_entity_type IN ('channel', 'document', 'initiative')) NOT VALID,
    ADD COLUMN initiative_message_parent_id uuid,
    ADD CONSTRAINT comms_messages_initiative_message_parent_id_fkey
        FOREIGN KEY (initiative_message_parent_id)
        REFERENCES initiative (id) ON DELETE CASCADE NOT VALID;

-- Keep the database-owned FK key consistent even for existing writers that
-- know only parent_entity_type/parent_entity_id. The FK serializes concurrent
-- parent deletion/message creation and cascades the message tree.
CREATE FUNCTION sync_initiative_message_parent() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.initiative_message_parent_id := CASE
        WHEN NEW.parent_entity_type = 'initiative' THEN NEW.parent_entity_id::uuid
        ELSE NULL
    END;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_initiative_message_parent
BEFORE INSERT OR UPDATE OF parent_entity_type, parent_entity_id, initiative_message_parent_id
ON comms_messages
FOR EACH ROW
EXECUTE FUNCTION sync_initiative_message_parent();

-- Mentions use a polymorphic source rather than a message FK. Remove their
-- message-owned rows when the initiative FK cascades messages away.
CREATE FUNCTION cleanup_initiative_message_mentions() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM comms_entity_mentions
    WHERE source_entity_type = 'message' AND source_entity_id = OLD.id::text;
    RETURN OLD;
END;
$$;

CREATE TRIGGER trg_cleanup_initiative_message_mentions
AFTER DELETE ON comms_messages
FOR EACH ROW WHEN (OLD.parent_entity_type = 'initiative')
EXECUTE FUNCTION cleanup_initiative_message_mentions();
