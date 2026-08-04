-- The trigger path resolves every channel message to its sessions with
-- WHERE created_from_thread_id = $1 OR thread_id = $1; thread_id is already
-- indexed, and without this index the OR does a bitmap scan with a slow half
-- on the message firehose.
CREATE INDEX agent_session_created_from_thread_id_idx
    ON agent_session (created_from_thread_id);
