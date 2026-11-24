-- no-transaction
-- A failed concurrent build can leave an INVALID index. Before retrying, inspect
-- pg_index.indisvalid and DROP INDEX CONCURRENTLY the invalid index only.
-- Rollback: DROP INDEX CONCURRENTLY email_mailbox_command_target_predecessors;
-- Keep existing indexes for rolling binaries and retained receipt reads.
CREATE INDEX CONCURRENTLY IF NOT EXISTS email_mailbox_command_target_predecessors
    ON email_mailbox_command_targets
        (message_id,parent_link_id,parent_generation,parent_accepted_order,command_id)
    WHERE parent_unfinished;
