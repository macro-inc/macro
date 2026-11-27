-- How often storing an attachment's copy has failed for a reason of its own,
-- and when Macro stopped trying. An abandoned attachment keeps its upload
-- claim, so no claim takes it again, and the Outlook projection no longer
-- waits on it. Both are metadata-only: the default is a constant and the
-- timestamp is nullable, so existing rows are not rewritten.
SET LOCAL lock_timeout = '5s';

ALTER TABLE email_attachments
    ADD COLUMN upload_failures SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN upload_abandoned_at TIMESTAMPTZ;
