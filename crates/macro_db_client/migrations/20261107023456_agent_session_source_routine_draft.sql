-- A session that drafts a routine from a person's words records who asked.
SET LOCAL lock_timeout = '5s';

ALTER TABLE agent_session_source
    DROP CONSTRAINT agent_session_source_kind_fields,
    ADD CONSTRAINT agent_session_source_kind_fields CHECK (
        CASE kind
            WHEN 'mentioned' THEN message_id IS NOT NULL
            WHEN 'conversation' THEN actor_user_id IS NOT NULL AND message_id IS NOT NULL
            WHEN 'task_assigned' THEN task_id IS NOT NULL
            WHEN 'project_inherited' THEN task_id IS NOT NULL AND project_id IS NOT NULL
            WHEN 'requested' THEN actor_user_id IS NOT NULL
            WHEN 'dispatched' THEN on_behalf_of_user_id IS NOT NULL
            WHEN 'routine' THEN routine_id IS NOT NULL AND routine_firing IS NOT NULL
            WHEN 'routine_draft' THEN actor_user_id IS NOT NULL
            ELSE false
        END
    ) NOT VALID;
