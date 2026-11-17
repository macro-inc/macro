-- A first activation can race an unreferenced bulk teardown. The writer records
-- one coarse team event; the worker pages raw consent owners before filtering.
-- No new events are produced while rule tables remain empty.
SET LOCAL lock_timeout = '5s';
ALTER TABLE crm_email_policy_source_events
    DROP CONSTRAINT crm_email_policy_source_events_source_kind_check,
    ADD CONSTRAINT crm_email_policy_source_events_source_kind_check
        CHECK (source_kind IN ('contact', 'company', 'team')) NOT VALID,
    ADD CONSTRAINT crm_email_policy_source_events_team_identity
        CHECK (source_kind <> 'team' OR source_id = team_id) NOT VALID;
