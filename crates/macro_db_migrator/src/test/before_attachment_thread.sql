-- A second thread, so the backfill must tell threads apart, and enough
-- attachments to span more than one 1000-page backfill batch.
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000e2f1', '00000000-0000-0000-0000-000000000e01',
        true, false, NOW(), NOW());

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000e5f1', '00000000-0000-0000-0000-00000000e2f1',
        '00000000-0000-0000-0000-000000000e01', 'provider-backfill-5f1', FALSE, NOW(),
        TRUE, FALSE, FALSE, FALSE, NOW(), NOW());

INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, size_bytes)
SELECT gen_random_uuid(),
       CASE WHEN n % 2 = 0 THEN '00000000-0000-0000-0000-00000000e501'::uuid
            ELSE '00000000-0000-0000-0000-00000000e5f1'::uuid END,
       'backfill-' || n,
       repeat('f', 500),
       'text/plain',
       n
FROM generate_series(1, 20000) AS n;

DO $$
BEGIN
    IF pg_relation_size('email_attachments') / current_setting('block_size')::bigint <= 1000 THEN
        RAISE EXCEPTION 'Fixture no longer spans more than one backfill batch';
    END IF;
END;
$$;
