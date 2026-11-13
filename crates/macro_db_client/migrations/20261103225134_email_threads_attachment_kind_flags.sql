-- Denormalized "thread has a PDF / image / document attachment" flags for the
-- Attachment email filter, by the MIME prefixes the web client's attachment
-- filters use. Like has_calendar_attachment, deriving them at query time would
-- join email_attachments against email_messages on every page load.
-- Maintained at attachment ingest and message delete (email_db_client
-- sync_thread_attachment_flags); existing threads are flagged by the
-- backfill_attachment_flags util in email_service.
SET LOCAL lock_timeout = '5s';

ALTER TABLE email_threads
    ADD COLUMN IF NOT EXISTS has_pdf_attachment boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS has_image_attachment boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS has_document_attachment boolean NOT NULL DEFAULT false;
