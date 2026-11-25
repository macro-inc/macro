-- The W3C trace context of the event's admission, so a routine's run joins
-- the trace of the change that started it. Nullable: runs admitted by code
-- from before it, and admissions outside a trace, have none.
SET LOCAL lock_timeout = '3s';
ALTER TABLE scheduled_action_event_run ADD COLUMN traceparent TEXT;
