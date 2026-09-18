-- Names the entity type behind `resource_id`: 'legacy_chat' (a cognition chat
-- written by the retired in-process executor) or 'agent_session' (a harness
-- session minted by the Kafka executor). Both ids are UUID-shaped, so the row
-- must carry the kind for the UI to open the right split.
--
-- Nullable and defaulted on purpose. A writer that predates this column omits
-- it and only ever wrote chats, so the default classifies those rows. The Kafka
-- executor names the column explicitly: NULL when the publish failed and no
-- transcript exists, a value otherwise.
ALTER TABLE action_execution_record
    ADD COLUMN IF NOT EXISTS transcript_kind TEXT DEFAULT 'legacy_chat';

COMMENT ON COLUMN action_execution_record.transcript_kind IS
    'Entity type of resource_id: legacy_chat | agent_session. NULL when resource_id is NULL. Default classifies rows from writers that predate the column.';

-- Rows the Kafka executor wrote before this column existed. The in-process
-- executor stored `result` as JSON null or a JSON string, never an object.
UPDATE action_execution_record
   SET transcript_kind = 'agent_session'
 WHERE resource_id IS NOT NULL
   AND jsonb_typeof(result) = 'object'
   AND result->>'status' = 'dispatched'
   AND transcript_kind = 'legacy_chat';

UPDATE action_execution_record
   SET transcript_kind = NULL
 WHERE resource_id IS NULL
   AND transcript_kind IS NOT NULL;
