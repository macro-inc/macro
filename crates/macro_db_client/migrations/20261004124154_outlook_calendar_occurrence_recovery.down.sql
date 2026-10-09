DROP TABLE calendar_outlook_away_checks;
DROP INDEX calendar_outlook_declines_reconcile;
DROP INDEX calendar_outlook_declines_identity;
ALTER TABLE calendar_outlook_declines DROP COLUMN mailbox_key, DROP COLUMN provider_calendar_id, DROP COLUMN next_check_at;
-- Keep historical orphan rows rather than deleting outcome-recovery evidence.
ALTER TABLE calendar_outlook_declines ADD CONSTRAINT calendar_outlook_declines_work_id_fkey
    FOREIGN KEY(work_id) REFERENCES calendar_outlook_work(id) ON DELETE CASCADE NOT VALID;
DROP FUNCTION calendar_outlook_mailbox_key(UUID);
ALTER TABLE calendar_event_overrides DROP COLUMN reminders, DROP COLUMN automatic_decline;
