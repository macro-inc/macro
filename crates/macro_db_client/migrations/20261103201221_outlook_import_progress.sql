-- Additive: Outlook import progress for telemetry. Both tables are small.
SET LOCAL lock_timeout = '1s';

-- Read on the folder_catalog stream: when its import run started, and when it
-- finished. The completion stamp lets "import completed" fire once per run.
-- now() is stable, so the default needs no table rewrite.
ALTER TABLE email_sync_streams
    ADD COLUMN import_started_at timestamptz DEFAULT now(),
    ADD COLUMN import_completed_at timestamptz;

-- Imports that finished before this column existed must not report again.
UPDATE email_sync_streams catalog SET import_completed_at = now()
WHERE catalog.kind = 'folder_catalog' AND catalog.initial_complete
    AND NOT EXISTS (
        SELECT 1 FROM email_sync_streams folder
        WHERE folder.link_id = catalog.link_id AND folder.generation = catalog.generation
            AND folder.kind = 'mail_folder' AND NOT folder.initial_complete
    )
    AND NOT EXISTS (
        SELECT 1 FROM email_message_reconciliation queued
        WHERE queued.link_id = catalog.link_id AND queued.generation = catalog.generation
            AND queued.is_import
    );

-- Messages each worker imported, flushed from memory once a minute so the
-- import path itself writes nothing extra. Rows older than a day are deleted.
CREATE TABLE email_mailbox_import_minutes (
    link_id uuid NOT NULL,
    minute timestamptz NOT NULL,
    imported integer NOT NULL,
    last_imported_at timestamptz NOT NULL,
    PRIMARY KEY (link_id, minute)
);
