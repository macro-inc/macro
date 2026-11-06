-- no-transaction

-- Fills email_attachments.thread_id on rows written before its trigger
-- (20261106191035), then makes it NOT NULL. Each batch is a range of heap
-- pages, so it rewrites neighbouring rows and commits on its own; no lock
-- outlives a batch. Rows written meanwhile already carry the column, and a
-- rerun after a failure only rewrites rows still NULL.
-- After each batch it sleeps as long as the batch took, so the WAL it adds,
-- which the read replica must replay, stays at half its unthrottled rate.
-- The NOT NULL check is validated before SET NOT NULL so that step skips the
-- table scan and holds its exclusive lock only briefly.
-- Keep this file a single statement: COMMIT inside DO needs a top-level call.
DO $$
DECLARE
    pages_per_batch CONSTANT bigint := 1000;
    page_count CONSTANT bigint :=
        pg_relation_size('email_attachments') / current_setting('block_size')::bigint;
    first_page bigint := 0;
    batch_started timestamptz;
BEGIN
    WHILE first_page < page_count LOOP
        batch_started := clock_timestamp();
        UPDATE email_attachments a
        SET thread_id = m.thread_id
        FROM email_messages m
        WHERE a.ctid >= format('(%s,0)', first_page)::tid
          AND a.ctid < format('(%s,0)', first_page + pages_per_batch)::tid
          AND a.thread_id IS NULL
          AND m.id = a.message_id;
        COMMIT;
        PERFORM pg_sleep(extract(epoch FROM clock_timestamp() - batch_started));
        first_page := first_page + pages_per_batch;
    END LOOP;

    PERFORM set_config('lock_timeout', '5s', true);
    ALTER TABLE email_attachments DROP CONSTRAINT IF EXISTS email_attachments_thread_id_not_null;
    ALTER TABLE email_attachments
        ADD CONSTRAINT email_attachments_thread_id_not_null CHECK (thread_id IS NOT NULL) NOT VALID;
    COMMIT;

    ALTER TABLE email_attachments VALIDATE CONSTRAINT email_attachments_thread_id_not_null;
    COMMIT;

    PERFORM set_config('lock_timeout', '5s', true);
    ALTER TABLE email_attachments ALTER COLUMN thread_id SET NOT NULL;
    ALTER TABLE email_attachments DROP CONSTRAINT email_attachments_thread_id_not_null;
END $$;
