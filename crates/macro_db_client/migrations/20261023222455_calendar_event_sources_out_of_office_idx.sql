-- no-transaction
-- The team out-of-office overlay reads teammates' out-of-office sources by
-- account. Without this index each call unpacked the payload of every source
-- on every primary calendar in the tenant to find the few that qualify.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- batch, and CONCURRENTLY cannot run inside a transaction. No IF NOT EXISTS:
-- an interrupted concurrent build leaves an invalid index that a retry must
-- not accept (see docs/design/outlook-email-support.md).
CREATE INDEX CONCURRENTLY calendar_event_sources_out_of_office_idx
    ON calendar_event_sources (account_id)
    WHERE event_type = 'out_of_office';
