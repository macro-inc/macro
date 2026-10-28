-- Initiative discussions use the same polymorphic parent fields as documents.
-- Add the allowed type without scanning existing messages under the DDL lock.
SET LOCAL lock_timeout = '5s';

ALTER TABLE comms_messages
    DROP CONSTRAINT comms_messages_parent_type_check,
    ADD CONSTRAINT comms_messages_parent_type_check
        CHECK (parent_entity_type IN ('channel', 'document', 'initiative')) NOT VALID;
