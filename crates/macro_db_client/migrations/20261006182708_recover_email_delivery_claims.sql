-- Additive fields keep existing workers compatible during deployment. Paused rows
-- retain processing=true so older workers cannot accidentally submit them again.
ALTER TABLE email_scheduled_messages
    ADD COLUMN delivery_claim_id UUID,
    ADD COLUMN delivery_lease_expires_at TIMESTAMPTZ,
    ADD COLUMN delivery_started_at TIMESTAMPTZ,
    ADD COLUMN delivery_message_id TEXT,
    ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'ready'
        CHECK (delivery_status IN ('ready', 'failed', 'unconfirmed'));

CREATE INDEX email_scheduled_delivery_recovery_idx
    ON email_scheduled_messages (delivery_lease_expires_at, send_time)
    WHERE NOT sent AND delivery_status <> 'failed';
