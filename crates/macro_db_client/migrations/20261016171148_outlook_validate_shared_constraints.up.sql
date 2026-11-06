SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '15min';

-- These scans use SHARE UPDATE EXCLUSIVE rather than the schema-changing lock.
-- Keep validation out of every transaction that adds columns or replaces checks.
ALTER TABLE microsoft_oauth_grants
    VALIDATE CONSTRAINT microsoft_oauth_grants_generation_check,
    VALIDATE CONSTRAINT microsoft_oauth_grants_revision_check;
ALTER TABLE email_links VALIDATE CONSTRAINT email_links_sync_generation_check;
ALTER TABLE calendar_accounts VALIDATE CONSTRAINT calendar_accounts_provider_check;
ALTER TABLE calendar_event_sources
    VALIDATE CONSTRAINT calendar_event_sources_source_kind_check,
    VALIDATE CONSTRAINT calendar_event_sources_shape;
ALTER TABLE calendar_events
    VALIDATE CONSTRAINT calendar_events_canonical_source_kind_check,
    VALIDATE CONSTRAINT calendar_events_conference_provider_check;
ALTER TABLE calendar_event_reminder_firings
    VALIDATE CONSTRAINT calendar_event_reminder_firings_method_check;
ALTER TABLE calendar_event_reminder_deliveries
    VALIDATE CONSTRAINT calendar_event_reminder_deliveries_method_check;
