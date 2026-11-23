SET LOCAL lock_timeout = '5s';

DROP INDEX IF EXISTS scheduled_action_draft_finished;
DROP INDEX IF EXISTS scheduled_action_draft_unfinished;
DROP INDEX IF EXISTS scheduled_action_draft_owner_client;
DROP INDEX IF EXISTS scheduled_action_draft_owner_jobs;

-- Job rows stay: without these columns they are plain drafts, which the
-- blocking sweep deletes after STALE_DRAFT, stopping their sessions.
ALTER TABLE scheduled_action_draft
    DROP COLUMN IF EXISTS client_id,
    DROP COLUMN IF EXISTS traceparent,
    DROP COLUMN IF EXISTS finished_at,
    DROP COLUMN IF EXISTS result,
    DROP COLUMN IF EXISTS progress,
    DROP COLUMN IF EXISTS request,
    DROP COLUMN IF EXISTS state;
