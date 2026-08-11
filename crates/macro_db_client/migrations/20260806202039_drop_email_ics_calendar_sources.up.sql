-- Email ICS ceased to be a calendar source: extraction only ever ran for
-- inboxes that also held the Google Calendar grant, where Google takes
-- unconditional precedence, so nothing it wrote survived reconciliation.
--
-- The down migration restores the schema shape but cannot restore rows.

-- Events whose only source was email drop out entirely; attendees,
-- overrides, occurrences, and sources all cascade from calendar_events.
DELETE FROM calendar_events WHERE canonical_source_kind = 'email_ics';

-- Google-canonical events keep their event row but lose the email source
-- record that was never reachable from the product.
DELETE FROM calendar_event_sources WHERE source_kind = 'email_ics';

-- calendar_sync_outbox rows cascade from the job.
DELETE FROM calendar_backfill_jobs WHERE kind = 'email_ics';

DROP INDEX IF EXISTS calendar_event_sources_email_idx;
DROP INDEX IF EXISTS calendar_event_sources_email_link_idx;

ALTER TABLE calendar_event_sources
    DROP CONSTRAINT IF EXISTS calendar_event_sources_email_link_id_fkey,
    DROP COLUMN IF EXISTS email_link_id,
    DROP COLUMN IF EXISTS email_thread_id,
    DROP COLUMN IF EXISTS email_message_id,
    DROP COLUMN IF EXISTS email_attachment_id,
    DROP COLUMN IF EXISTS content_hash;

ALTER TABLE calendar_event_sources
    DROP CONSTRAINT IF EXISTS calendar_event_sources_shape,
    DROP CONSTRAINT IF EXISTS calendar_event_sources_source_kind_check;

ALTER TABLE calendar_event_sources
    ADD CONSTRAINT calendar_event_sources_source_kind_check
        CHECK (source_kind = 'google'),
    ADD CONSTRAINT calendar_event_sources_shape CHECK (
        source_kind = 'google'
        AND account_id IS NOT NULL
        AND calendar_id IS NOT NULL
        AND provider_event_id IS NOT NULL
    );

ALTER TABLE calendar_events
    DROP CONSTRAINT IF EXISTS calendar_events_canonical_source_kind_check;
ALTER TABLE calendar_events
    ADD CONSTRAINT calendar_events_canonical_source_kind_check
        CHECK (canonical_source_kind = 'google');

ALTER TABLE calendar_backfill_jobs
    DROP CONSTRAINT IF EXISTS calendar_backfill_jobs_kind_check;
ALTER TABLE calendar_backfill_jobs
    ADD CONSTRAINT calendar_backfill_jobs_kind_check
        CHECK (kind = 'google_calendar');
