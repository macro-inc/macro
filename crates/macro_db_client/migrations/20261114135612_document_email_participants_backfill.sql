-- no-transaction

-- Record the participants of every document already linked to an email
-- attachment. The triggers record every link made since they were created,
-- so this walks only what existed before. Batches walk the attachment ids in
-- order and commit on their own, each with the last attachment it covered in
-- document_email_participants_backfill: a rerun after a failure resumes after
-- the last committed batch. The table is dropped once every batch is in.
-- Keep this file a single statement: COMMIT inside DO needs a top-level call.
DO $$
DECLARE
    batch_size CONSTANT integer := 2000;
    resume_after uuid;
    attachment_ids uuid[];
BEGIN
    CREATE TABLE IF NOT EXISTS document_email_participants_backfill (
        single boolean PRIMARY KEY DEFAULT true CHECK (single),
        last_attachment_id uuid NOT NULL
    );
    INSERT INTO document_email_participants_backfill (last_attachment_id)
    VALUES ('00000000-0000-0000-0000-000000000000')
    ON CONFLICT DO NOTHING;
    SELECT last_attachment_id INTO resume_after FROM document_email_participants_backfill;
    COMMIT;

    LOOP
        SELECT array_agg(batch.email_attachment_id ORDER BY batch.email_attachment_id)
        INTO attachment_ids
        FROM (
            SELECT DISTINCT email_attachment_id
            FROM document_email
            WHERE email_attachment_id > resume_after
            ORDER BY email_attachment_id
            LIMIT batch_size
        ) batch;
        EXIT WHEN attachment_ids IS NULL;

        PERFORM record_document_email_participants(attachment_ids);
        resume_after := attachment_ids[cardinality(attachment_ids)];
        UPDATE document_email_participants_backfill SET last_attachment_id = resume_after;
        COMMIT;
    END LOOP;

    DROP TABLE document_email_participants_backfill;
END
$$;
