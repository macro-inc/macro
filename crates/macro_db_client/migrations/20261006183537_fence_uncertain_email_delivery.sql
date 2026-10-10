-- A worker from an older deployment may try to clear processing after losing a
-- claim. Keep uncertain submissions hidden from its unfenced claim query.
-- Old rows retain the defaults and old successful completion remains valid.
ALTER TABLE email_scheduled_messages
    ADD CONSTRAINT email_delivery_uncertainty_keeps_processing
    CHECK (sent OR processing OR delivery_status = 'failed'
           OR (delivery_status = 'ready' AND delivery_started_at IS NULL));
