-- The generated key supplies a real FK for the polymorphic initiative parent.
-- It serializes concurrent deletion/creation and cascades the shared message
-- tree without an application-side check/delete race.
ALTER TABLE comms_messages
    DROP CONSTRAINT comms_messages_parent_type_check,
    ADD CONSTRAINT comms_messages_parent_type_check
        CHECK (parent_entity_type IN ('channel', 'document', 'initiative')),
    ADD COLUMN initiative_message_parent_id uuid GENERATED ALWAYS AS (
        CASE WHEN parent_entity_type = 'initiative' THEN parent_entity_id::uuid END
    ) STORED REFERENCES initiative (id) ON DELETE CASCADE;

CREATE INDEX idx_comms_messages_initiative_parent
    ON comms_messages (initiative_message_parent_id)
    WHERE initiative_message_parent_id IS NOT NULL;

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
