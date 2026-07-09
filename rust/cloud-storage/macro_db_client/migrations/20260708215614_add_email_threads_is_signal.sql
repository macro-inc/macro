-- Denormalized "thread has a signal (important) message" flag for the
-- Importance soup filter. Deriving it at query time evaluates the per-message
-- importance heuristic (category labels + email_filters sender overrides)
-- twice per preview query. Maintained by update_thread_metadata
-- (email_db_client and the email crate); existing threads are flagged by the
-- backfill_signal_flags util in email_service.
ALTER TABLE email_threads
    ADD COLUMN IF NOT EXISTS is_signal boolean NOT NULL DEFAULT false;
