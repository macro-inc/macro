SET LOCAL lock_timeout = '5s';

DROP INDEX IF EXISTS scheduled_action_draft_owner_client;
DROP INDEX IF EXISTS scheduled_action_draft_owner_jobs;

-- Job rows mean nothing to code without jobs; blocking drafts keep theirs.
DELETE FROM scheduled_action_draft WHERE state IS NOT NULL;

ALTER TABLE scheduled_action_draft
    DROP COLUMN IF EXISTS client_id,
    DROP COLUMN IF EXISTS traceparent,
    DROP COLUMN IF EXISTS finished_at,
    DROP COLUMN IF EXISTS result,
    DROP COLUMN IF EXISTS progress,
    DROP COLUMN IF EXISTS request,
    DROP COLUMN IF EXISTS state;
