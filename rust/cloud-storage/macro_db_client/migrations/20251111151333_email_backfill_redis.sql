-- we now use redis to track backfill progress instead of postgres

drop table email_backfill_messages;

drop table email_backfill_threads;

ALTER TABLE email_backfill_jobs
DROP COLUMN threads_processed_count,
DROP COLUMN messages_retrieved_count,
DROP COLUMN messages_processed_count,
DROP COLUMN threads_succeeded_count,
DROP COLUMN threads_skipped_count,
DROP COLUMN threads_failed_count,
DROP COLUMN messages_succeeded_count,
DROP COLUMN messages_failed_count;
