-- no-transaction

-- Record the participants of every document already linked to an email
-- attachment. The triggers record every link made since they were created,
-- so this walks only what existed before. Batches walk the attachment ids in
-- order and commit on their own; a rerun inserts nothing it already has.
-- Keep this file a single statement: COMMIT inside DO needs a top-level call.
DO $$
DECLARE
    batch_size CONSTANT integer := 2000;
    last_attachment_id uuid := '00000000-0000-0000-0000-000000000000';
    attachment_ids uuid[];
BEGIN
    LOOP
        SELECT array_agg(batch.email_attachment_id ORDER BY batch.email_attachment_id)
        INTO attachment_ids
        FROM (
            SELECT DISTINCT email_attachment_id
            FROM document_email
            WHERE email_attachment_id > last_attachment_id
            ORDER BY email_attachment_id
            LIMIT batch_size
        ) batch;
        EXIT WHEN attachment_ids IS NULL;

        PERFORM record_document_email_participants(attachment_ids);
        COMMIT;

        last_attachment_id := attachment_ids[cardinality(attachment_ids)];
    END LOOP;
END
$$;
