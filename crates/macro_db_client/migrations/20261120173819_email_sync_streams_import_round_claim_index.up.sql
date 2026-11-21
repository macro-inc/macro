-- no-transaction
-- A mail folder's import round is claimed ahead of finished folders that came
-- due less than a few minutes before it. Import rounds are about one in a
-- hundred folder streams, and the due finished folders sort ahead of them in
-- email_sync_streams_claim, so finding the longest-due import round there
-- would read every due finished folder on each claim. This index holds only
-- import rounds.
-- Single statement: CONCURRENTLY forbids the implicit transaction of a
-- batch. No IF NOT EXISTS, so an INVALID index left by an interrupted build
-- fails the next run instead of passing: drop it by hand and run again.
-- Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
CREATE INDEX CONCURRENTLY email_sync_streams_import_round_claim
    ON email_sync_streams (next_run_at, id)
    WHERE kind = 'mail_folder' AND NOT initial_complete;
