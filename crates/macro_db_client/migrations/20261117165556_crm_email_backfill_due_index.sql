-- no-transaction
-- One entry per queued contributor, never per message/contact. Updated only by
-- scheduling/publication, allowing retained recovery signals to remain cheap.
-- If interrupted, drop an INVALID index before retrying this migration.
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_email_backfill_outbox_due
    ON crm_email_backfill_outbox (requested_at, team_id, user_id);
