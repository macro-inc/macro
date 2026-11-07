DROP TABLE team_invite_harness_grant;

ALTER TABLE entity_access_request DROP COLUMN requested_by_agent;

DROP FUNCTION harness_can_run(uuid, text);
DROP FUNCTION harness_access_level(uuid, text);

-- Grants made since cannot be expressed by the old model: a runtime with a team
-- grant returns to being team-owned, and every other grant is dropped.
UPDATE harnesses h
SET owner_user_id = NULL, team_id = ea.source_id::uuid
FROM entity_access ea
WHERE ea.entity_id = h.id
  AND ea.entity_type = 'harness'
  AND ea.source_type = 'team';

DELETE FROM entity_access WHERE entity_type = 'harness';
DELETE FROM entity_access_request WHERE entity_type = 'harness';
