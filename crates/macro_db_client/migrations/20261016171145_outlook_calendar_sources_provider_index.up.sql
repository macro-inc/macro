-- no-transaction
CREATE UNIQUE INDEX CONCURRENTLY calendar_event_sources_provider_idx
    ON calendar_event_sources (account_id, calendar_id, provider_event_id);
