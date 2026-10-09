ALTER TABLE calendar_accounts DROP CONSTRAINT calendar_accounts_provider_check;
ALTER TABLE calendar_accounts ADD CONSTRAINT calendar_accounts_provider_check CHECK(provider IN ('google','outlook'));
ALTER TABLE calendar_event_sources DROP CONSTRAINT calendar_event_sources_source_kind_check;
ALTER TABLE calendar_event_sources DROP CONSTRAINT calendar_event_sources_shape;
ALTER TABLE calendar_event_sources ADD CONSTRAINT calendar_event_sources_source_kind_check CHECK(source_kind IN ('google','outlook'));
ALTER TABLE calendar_event_sources ADD CONSTRAINT calendar_event_sources_shape CHECK(account_id IS NOT NULL AND calendar_id IS NOT NULL AND provider_event_id IS NOT NULL);
ALTER TABLE calendar_events DROP CONSTRAINT calendar_events_canonical_source_kind_check;
ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_canonical_source_kind_check CHECK(canonical_source_kind IN ('google','outlook'));
CREATE UNIQUE INDEX calendar_event_sources_provider_idx ON calendar_event_sources(account_id,calendar_id,provider_event_id);
