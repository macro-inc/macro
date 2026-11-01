-- Onboarding no longer gathers or imports automatically.
--
-- Settle runs it left mid-import: nothing will finish them, and Slack
-- discovery only restarts terminal runs. Remove the candidates it staged that
-- nobody reviewed and no import attempted, as onboarding completion used to;
-- never-reviewed is not declined, so chat or Slack discovery can stage them
-- again. Failed automatic imports (staged with `last_error`) stay retryable.
-- Rows it left `importing` are reset by the service's stale-import reaper.
-- Runs before import_entity gains its self-referencing foreign key, so the
-- delete fires no cascade checks.
SET LOCAL lock_timeout = '5s';

UPDATE import_run
SET status = 'completed', updated_at = NOW()
WHERE status = 'importing';

DELETE FROM import_entity
WHERE initiator = 'onboarding' AND status = 'staged' AND last_error IS NULL;
