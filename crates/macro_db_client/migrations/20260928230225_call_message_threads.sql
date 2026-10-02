-- Call chat uses the shared message/thread schema and retains its identity
-- when the ephemeral call is archived into call_records.
-- Defer validation until this DDL transaction releases its stronger locks.
SET LOCAL lock_timeout = '5s';

ALTER TABLE comms_messages
    DROP CONSTRAINT comms_messages_parent_type_check,
    ADD CONSTRAINT comms_messages_parent_type_check
        CHECK (parent_entity_type IN ('channel', 'document', 'initiative', 'crm_company', 'crm_contact', 'call')) NOT VALID,
    DROP CONSTRAINT IF EXISTS comms_messages_call_thread_check,
    ADD CONSTRAINT comms_messages_call_thread_check
        CHECK (parent_entity_type <> 'call' OR
            (thread_id IS NULL AND id::text = parent_entity_id) OR
            (thread_id IS NOT NULL AND thread_id::text = parent_entity_id)) NOT VALID;

-- Polymorphic call parents live in either calls or call_records. Archival
-- inserts the permanent row before deleting the ephemeral one; cleanup only
-- runs once neither form remains. Message foreign keys cascade to replies,
-- thread metadata, attachments, and reactions.
CREATE OR REPLACE FUNCTION cleanup_call_messages() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.id::text, 0));
    IF NOT EXISTS (SELECT 1 FROM calls WHERE id = OLD.id)
        AND NOT EXISTS (SELECT 1 FROM call_records WHERE id = OLD.id) THEN
        -- Mention references are polymorphic and have no message foreign key.
        DELETE FROM comms_entity_mentions
        WHERE source_entity_type = 'message' AND source_entity_id IN (
            SELECT id::text FROM comms_messages
            WHERE parent_entity_type = 'call' AND parent_entity_id = OLD.id::text
        );
        DELETE FROM comms_messages
        WHERE parent_entity_type = 'call' AND parent_entity_id = OLD.id::text;
    END IF;
    RETURN OLD;
END;
$$;

CREATE OR REPLACE TRIGGER trg_cleanup_active_call_messages
AFTER DELETE ON calls
FOR EACH ROW EXECUTE FUNCTION cleanup_call_messages();

CREATE OR REPLACE TRIGGER trg_cleanup_call_record_messages
AFTER DELETE ON call_records
FOR EACH ROW EXECUTE FUNCTION cleanup_call_messages();

-- The first call message takes the call's canonical root id. Keep its
-- original request id so retrying a lost response cannot append it again.
ALTER TABLE comms_messages ADD COLUMN IF NOT EXISTS client_message_id uuid;
