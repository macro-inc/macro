-- no-transaction
-- A separate concurrent build avoids blocking message writes. Keep this file
-- to one statement so SQLx does not use an implicit transaction block.
CREATE INDEX CONCURRENTLY idx_comms_messages_initiative_parent
    ON comms_messages (initiative_message_parent_id)
    WHERE initiative_message_parent_id IS NOT NULL;
