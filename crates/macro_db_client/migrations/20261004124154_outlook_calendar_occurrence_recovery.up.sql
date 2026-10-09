ALTER TABLE calendar_event_overrides ADD COLUMN reminders JSONB, ADD COLUMN automatic_decline JSONB;

-- Identity survives calendar disconnect, sync resets, and reconnecting the same
-- provider mailbox under a new local link. Only opaque identifiers are hashed.
CREATE FUNCTION calendar_outlook_mailbox_key(link UUID) RETURNS TEXT LANGUAGE SQL STABLE AS $$
    SELECT encode(sha256(convert_to(jsonb_build_array(
        COALESCE(provider_tenant_id,id::text),COALESCE(provider_mailbox_id,id::text)
    )::text,'UTF8')),'hex') FROM email_links WHERE id=link
$$;
ALTER TABLE calendar_outlook_declines DROP CONSTRAINT calendar_outlook_declines_work_id_fkey;
ALTER TABLE calendar_outlook_declines ADD COLUMN mailbox_key TEXT, ADD COLUMN provider_calendar_id TEXT,
    ADD COLUMN next_check_at TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE calendar_outlook_declines d SET mailbox_key=calendar_outlook_mailbox_key(a.email_link_id),provider_calendar_id=c.provider_calendar_id
    FROM calendar_outlook_work w JOIN calendar_accounts a ON a.id=w.account_id JOIN calendars c ON c.id=w.calendar_id WHERE w.id=d.work_id;
ALTER TABLE calendar_outlook_declines ALTER COLUMN mailbox_key SET NOT NULL, ALTER COLUMN provider_calendar_id SET NOT NULL;
CREATE UNIQUE INDEX calendar_outlook_declines_identity ON calendar_outlook_declines(mailbox_key,invitation_id,COALESCE(recurrence_id,''));
CREATE INDEX calendar_outlook_declines_reconcile ON calendar_outlook_declines(mailbox_key,provider_calendar_id,next_check_at) WHERE confirmed_at IS NULL;

-- Checked candidates yield to unchecked ones, including when a stale projection
-- is rejected by a fresh provider read. This keeps bounded passes from starving
-- later invitations or blocking the calendar sync checkpoint.
CREATE TABLE calendar_outlook_away_checks (
    work_id UUID NOT NULL REFERENCES calendar_outlook_work(id) ON DELETE CASCADE,
    away_id TEXT NOT NULL,
    away_recurrence TEXT NOT NULL DEFAULT '',
    invitation_id TEXT NOT NULL,
    invitation_recurrence TEXT NOT NULL DEFAULT '',
    checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    next_check_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(work_id,away_id,away_recurrence,invitation_id,invitation_recurrence)
);
