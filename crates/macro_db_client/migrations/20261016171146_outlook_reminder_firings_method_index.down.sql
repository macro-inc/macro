-- no-transaction
-- Only reached before the forward-only constraint cutover owns this index.
DROP INDEX CONCURRENTLY calendar_event_reminder_firings_method_key;
