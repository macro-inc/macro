-- no-transaction
-- The Inbox (Signal and Noise) sorts by
-- GREATEST(latest_inbound_message_ts, reminder_returned_at), so the
-- attachment filter's idx_email_threads_document_attachment_view, in All Mail order,
-- cannot stop at the LIMIT: an Inbox page of document threads would read every
-- flagged thread of the mailbox. A per-link scan of this index stops at LIMIT.
-- Single statement: CONCURRENTLY forbids the implicit transaction of a batch.
-- No IF NOT EXISTS, so an INVALID index left by an interrupted build fails the
-- next run instead of passing: drop it by hand and run again. Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
CREATE INDEX CONCURRENTLY idx_email_threads_document_attachment_inbox_view
    ON email_threads (link_id, (GREATEST(latest_inbound_message_ts, reminder_returned_at)) DESC, id DESC)
    WHERE inbox_visible AND has_document_attachment;
