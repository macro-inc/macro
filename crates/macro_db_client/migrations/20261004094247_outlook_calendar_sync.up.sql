ALTER TABLE calendars ADD COLUMN online_meeting_providers text[] NOT NULL DEFAULT '{}';
ALTER TABLE calendar_events DROP CONSTRAINT calendar_events_conference_provider_check;
ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_conference_provider_check CHECK(conference_provider IN ('google_meet','microsoft_teams','other'));
CREATE TABLE calendar_outlook_work (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES calendar_accounts(id) ON DELETE CASCADE,
    calendar_id uuid REFERENCES calendars(id) ON DELETE CASCADE,
    sync_generation bigint NOT NULL,
    grant_generation bigint NOT NULL,
    cursor text,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    next_run_at timestamptz NOT NULL DEFAULT now(),
    lease_id uuid,
    lease_until timestamptz,
    last_error text,
    attempts integer NOT NULL DEFAULT 0,
    CHECK(ends_at>starts_at)
);
-- PostgreSQL 14 treats NULLs as distinct in unique constraints. Separate indexes
-- enforce one discovery row per account and one sync row per account/calendar.
CREATE UNIQUE INDEX calendar_outlook_work_account_unique
    ON calendar_outlook_work(account_id) WHERE calendar_id IS NULL;
CREATE UNIQUE INDEX calendar_outlook_work_calendar_unique
    ON calendar_outlook_work(account_id,calendar_id) WHERE calendar_id IS NOT NULL;
CREATE INDEX calendar_outlook_work_due ON calendar_outlook_work(next_run_at);
-- The event row and its publication intent commit together. Revision-CAS
-- acknowledgments preserve changes arriving during an in-flight publication.
CREATE TABLE calendar_projection_outbox (
    event_id uuid PRIMARY KEY,
    owner_id text NOT NULL,
    link_id uuid NOT NULL,
    change_kind text NOT NULL CHECK(change_kind IN ('created','updated','deleted')),
    revision bigint NOT NULL DEFAULT 1,
    next_run_at timestamptz NOT NULL DEFAULT now(),
    lease_id uuid,
    lease_until timestamptz
);
CREATE FUNCTION calendar_outlook_projection_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_value calendar_events;
BEGIN
    IF TG_OP='DELETE' THEN row_value:=OLD; ELSE row_value:=NEW; END IF;
    IF row_value.canonical_source_kind='outlook' THEN
        INSERT INTO calendar_projection_outbox(event_id,owner_id,link_id,change_kind)
        VALUES(row_value.id,row_value.owner_id,row_value.source_link_id,lower(CASE WHEN TG_OP='INSERT' THEN 'created' WHEN TG_OP='UPDATE' THEN 'updated' ELSE 'deleted' END))
        ON CONFLICT(event_id) DO UPDATE SET change_kind=EXCLUDED.change_kind,owner_id=EXCLUDED.owner_id,link_id=EXCLUDED.link_id,revision=calendar_projection_outbox.revision+1,next_run_at=now();
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER calendar_outlook_projection_changed AFTER INSERT OR UPDATE OR DELETE ON calendar_events FOR EACH ROW EXECUTE FUNCTION calendar_outlook_projection_changed();
