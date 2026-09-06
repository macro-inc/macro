-- Separate read context: preserve every raw ACP frame byte-for-byte.
-- The old Cursor adapter acknowledged loads without replaying history.
-- Only attempts already persisted at rollout get the compatibility behavior;
-- all future loads (including Cursor) have standard ACP replacement semantics.
ALTER TABLE agent_session_log ADD COLUMN legacy_load boolean NOT NULL DEFAULT false;
UPDATE agent_session_log AS log
SET legacy_load = true
FROM external_agent_session AS external
WHERE external.agent_session_id = log.agent_session_id
  AND external.provider = 'cursor'
  AND log.direction = 'to_runtime'
  AND log.content->>'method' = 'session/load';
