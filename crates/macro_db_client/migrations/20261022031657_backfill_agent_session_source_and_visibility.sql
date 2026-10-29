-- Existing hidden sessions, then the sessions earlier routine runs created,
-- from the routines' run history. Those predate the routine setting, so they
-- take its default: unlisted.
SET LOCAL lock_timeout = '5s';
UPDATE agent_session
SET visibility = 'hidden'
WHERE list_hidden
  AND visibility <> 'hidden';

UPDATE agent_session AS s
SET source = 'routine', visibility = 'unlisted'
FROM action_execution_record AS r
WHERE r.resource_id = s.id::text
  AND NOT s.list_hidden
  AND (s.source <> 'routine' OR s.visibility <> 'unlisted');
