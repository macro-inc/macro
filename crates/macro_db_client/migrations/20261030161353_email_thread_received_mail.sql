-- no-transaction

-- has_received_mail records whether a thread holds mail the user received:
-- a message that is neither a draft nor sent, or sent mail addressed back to
-- its own sender. A constant default only changes the catalog, and
-- rows keep reading true until their next metadata recompute.
--
-- Draft-only threads are the rows whose visibility changes now. One read of
-- the draft partial index finds them, then each batch commits on its own, so
-- no lock outlives a batch. Each update rechecks that the thread is still
-- draft-only and not yet converted, so a rerun after a failure is safe.
-- Keep this file a single statement: COMMIT inside DO needs a top-level call.
DO $$
DECLARE
    batch_size CONSTANT integer := 1000;
    draft_only uuid[];
    batch_start integer := 1;
    batch_updated integer;
    updated bigint := 0;
BEGIN
    SET LOCAL lock_timeout = '5s';
    ALTER TABLE email_threads
        ADD COLUMN IF NOT EXISTS has_received_mail BOOLEAN NOT NULL DEFAULT TRUE;
    COMMIT;

    SELECT COALESCE(array_agg(DISTINCT draft.thread_id), '{}')
    INTO draft_only
    FROM email_messages draft
    WHERE draft.is_draft
      AND NOT EXISTS (
            SELECT 1 FROM email_messages other
            WHERE other.thread_id = draft.thread_id AND NOT other.is_draft
      );
    COMMIT;

    WHILE batch_start <= cardinality(draft_only) LOOP
        -- recompute_thread_metadata for a thread without received mail: drafts
        -- no longer keep it in the inbox or stand in for an inbound timestamp.
        UPDATE email_threads thread
        SET has_received_mail = FALSE,
            latest_inbound_message_ts = NULL,
            inbox_visible = EXISTS (
                SELECT 1
                FROM email_messages m
                JOIN email_message_mailbox_facts f ON f.id = m.id
                WHERE m.thread_id = thread.id AND m.link_id = thread.link_id
                  AND f.is_present AND f.in_inbox
                  AND (NOT f.in_sent OR (thread.reminder_returned_at IS NOT NULL
                       AND NOT f.in_trash AND NOT f.in_junk))
            ),
            updated_at = now()
        WHERE thread.id = ANY(draft_only[batch_start:batch_start + batch_size - 1])
          AND thread.has_received_mail
          AND NOT EXISTS (
                SELECT 1 FROM email_messages other
                WHERE other.thread_id = thread.id AND NOT other.is_draft
          );
        GET DIAGNOSTICS batch_updated = ROW_COUNT;
        updated := updated + batch_updated;
        COMMIT;
        batch_start := batch_start + batch_size;
    END LOOP;

    RAISE NOTICE 'moved % draft-only email threads out of the inbox', updated;
END $$;
