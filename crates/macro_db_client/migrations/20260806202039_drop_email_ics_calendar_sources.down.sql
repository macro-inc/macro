-- Restores the email-ICS schema shape. Rows deleted by the up migration are
-- not recoverable; a reversal leaves the email columns empty.

ALTER TABLE calendar_backfill_jobs
    DROP CONSTRAINT IF EXISTS calendar_backfill_jobs_kind_check;
ALTER TABLE calendar_backfill_jobs
    ADD CONSTRAINT calendar_backfill_jobs_kind_check
        CHECK (kind IN ('google_calendar', 'email_ics'));

ALTER TABLE calendar_events
    DROP CONSTRAINT IF EXISTS calendar_events_canonical_source_kind_check;
ALTER TABLE calendar_events
    ADD CONSTRAINT calendar_events_canonical_source_kind_check
        CHECK (canonical_source_kind IN ('google', 'email_ics'));

ALTER TABLE calendar_event_sources
    ADD COLUMN IF NOT EXISTS email_link_id uuid,
    ADD COLUMN IF NOT EXISTS email_thread_id uuid,
    ADD COLUMN IF NOT EXISTS email_message_id uuid,
    ADD COLUMN IF NOT EXISTS email_attachment_id text,
    ADD COLUMN IF NOT EXISTS content_hash text;

ALTER TABLE calendar_event_sources
    ADD CONSTRAINT calendar_event_sources_email_link_id_fkey
        FOREIGN KEY (email_link_id) REFERENCES email_links(id) ON DELETE CASCADE;

ALTER TABLE calendar_event_sources
    DROP CONSTRAINT IF EXISTS calendar_event_sources_shape,
    DROP CONSTRAINT IF EXISTS calendar_event_sources_source_kind_check;

ALTER TABLE calendar_event_sources
    ADD CONSTRAINT calendar_event_sources_source_kind_check
        CHECK (source_kind IN ('google', 'email_ics')),
    ADD CONSTRAINT calendar_event_sources_shape CHECK (
        (
            source_kind = 'google'
            AND account_id IS NOT NULL
            AND calendar_id IS NOT NULL
            AND provider_event_id IS NOT NULL
            AND email_link_id IS NULL
        )
        OR (
            source_kind = 'email_ics'
            AND email_link_id IS NOT NULL
            AND email_message_id IS NOT NULL
            AND content_hash IS NOT NULL
            AND account_id IS NULL
            AND calendar_id IS NULL
            AND provider_event_id IS NULL
        )
    );

CREATE UNIQUE INDEX IF NOT EXISTS calendar_event_sources_email_idx
    ON calendar_event_sources (
        email_link_id, email_message_id, COALESCE(email_attachment_id, ''), content_hash, event_id
    )
    WHERE source_kind = 'email_ics';

CREATE INDEX IF NOT EXISTS calendar_event_sources_email_link_idx
    ON calendar_event_sources (email_link_id)
    WHERE email_link_id IS NOT NULL;
