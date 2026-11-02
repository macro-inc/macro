-- WhatsApp attachments are stored as static files, like channel images, not
-- as private documents. The id reserved per attachment (and returned for an
-- upload) only keys its staged bytes now; the static file id is recorded once
-- the bytes are stored. The tables hold no rows yet: the session service has
-- never run in a deployed environment.
SET LOCAL lock_timeout = '5s';

ALTER TABLE whatsapp_group_attachment RENAME COLUMN document_id TO blob_id;
ALTER INDEX whatsapp_group_attachment_document_id_key RENAME TO whatsapp_group_attachment_blob_id_key;
ALTER TABLE whatsapp_group_attachment
    ADD COLUMN file_id uuid UNIQUE,
    ADD CONSTRAINT whatsapp_group_attachment_ready_file CHECK (state <> 'ready' OR file_id IS NOT NULL);

ALTER TABLE whatsapp_media_blob RENAME COLUMN document_id TO id;

-- Static files no attachment references any more (the message was deleted,
-- or its chat or owner went away), until DSS deletes them from the static
-- file service.
CREATE TABLE whatsapp_file_deletion (
    file_id uuid PRIMARY KEY,
    retry_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_file_deletion_retry ON whatsapp_file_deletion(retry_at);

CREATE FUNCTION whatsapp_attachment_release_file() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.file_id IS NOT NULL AND (TG_OP = 'DELETE' OR NEW.file_id IS DISTINCT FROM OLD.file_id) THEN
        INSERT INTO whatsapp_file_deletion (file_id) VALUES (OLD.file_id) ON CONFLICT DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER whatsapp_attachment_release_file AFTER DELETE OR UPDATE OF file_id ON whatsapp_group_attachment
FOR EACH ROW EXECUTE FUNCTION whatsapp_attachment_release_file();
