-- Cancellation removes the schedule, so failed deliveries never need to expose
-- processing=false. This also fences late unfenced clears from older workers.
ALTER TABLE email_scheduled_messages
    DROP CONSTRAINT email_delivery_uncertainty_keeps_processing,
    ADD CONSTRAINT email_delivery_uncertainty_keeps_processing
    CHECK (sent OR processing
           OR (delivery_status = 'ready' AND delivery_started_at IS NULL));
