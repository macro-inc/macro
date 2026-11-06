DO $$
BEGIN
    IF (SELECT count(*) FROM email_attachments) <> 20000 THEN
        RAISE EXCEPTION 'Backfill changed the attachment rows';
    END IF;

    IF EXISTS (SELECT 1 FROM email_attachments a
               JOIN email_messages m ON m.id = a.message_id
               WHERE a.thread_id IS DISTINCT FROM m.thread_id)
    THEN
        RAISE EXCEPTION 'Backfill left an attachment off its message''s thread';
    END IF;

    IF (SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'email_attachments' AND column_name = 'thread_id') <> 'NO'
       OR EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'email_attachments_thread_id_not_null')
    THEN
        RAISE EXCEPTION 'thread_id is not plain NOT NULL';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_index
                   WHERE indexrelid = 'idx_email_attachments_thread_id_created_at'::regclass
                     AND indisvalid)
    THEN
        RAISE EXCEPTION 'thread_id index is missing or invalid';
    END IF;
END;
$$;
