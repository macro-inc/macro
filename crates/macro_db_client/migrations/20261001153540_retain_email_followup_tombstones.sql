-- Preserve workflow identity after a thread/inbox is deleted. Otherwise cascade
-- would leave an enabled ordinary reminder with no specialization, allowing a
-- queued occurrence to bypass the deleted-thread check. The owning user's and
-- reminder's cascades still clean up this state; reconciliation disables it.
ALTER TABLE reminder_email_followup
    DROP CONSTRAINT reminder_email_followup_thread_id_fkey,
    DROP CONSTRAINT reminder_email_followup_link_id_fkey;
ALTER TABLE reminder_email_operation
    DROP CONSTRAINT reminder_email_operation_thread_id_fkey;
