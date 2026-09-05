-- The working directory the session's harness runs in, snapshotted at
-- creation like model/harness/repo_url. Managed containers pass the path
-- baked into their image; external (self-hosted) runtimes state theirs when
-- they create the session. Snapshotting is what keeps resume/load correct:
-- they re-enter the directory the session actually ran in, not whatever the
-- runtime is configured with today.
--
-- The default exists only to backfill rows created before this column, and
-- is dropped immediately: every new row states its workspace explicitly.
ALTER TABLE agent_session
    ADD COLUMN workspace TEXT NOT NULL DEFAULT '/workspace';

ALTER TABLE agent_session
    ALTER COLUMN workspace DROP DEFAULT;
