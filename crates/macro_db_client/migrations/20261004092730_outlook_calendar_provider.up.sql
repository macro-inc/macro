SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

ALTER TABLE calendar_accounts DROP CONSTRAINT calendar_accounts_provider_check;
ALTER TABLE calendar_accounts ADD CONSTRAINT calendar_accounts_provider_check CHECK(provider IN ('google','outlook')) NOT VALID;
ALTER TABLE calendar_event_sources DROP CONSTRAINT calendar_event_sources_source_kind_check;
ALTER TABLE calendar_event_sources DROP CONSTRAINT calendar_event_sources_shape;
ALTER TABLE calendar_event_sources ADD CONSTRAINT calendar_event_sources_source_kind_check CHECK(source_kind IN ('google','outlook')) NOT VALID;
ALTER TABLE calendar_event_sources ADD CONSTRAINT calendar_event_sources_shape CHECK(account_id IS NOT NULL AND calendar_id IS NOT NULL AND provider_event_id IS NOT NULL) NOT VALID;
ALTER TABLE calendar_events DROP CONSTRAINT calendar_events_canonical_source_kind_check;
ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_canonical_source_kind_check CHECK(canonical_source_kind IN ('google','outlook')) NOT VALID;
-- Validate these checks and build the provider index in separate migrations.
