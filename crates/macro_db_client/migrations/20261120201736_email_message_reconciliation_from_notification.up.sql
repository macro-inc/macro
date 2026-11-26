-- A change notification queued the message by the id it names, rather than a
-- folder page listing it. Reconciliation stores such a message only when a
-- folder page would have listed it, and records the source on its span.
SET LOCAL lock_timeout = '5s';
ALTER TABLE email_message_reconciliation
    ADD COLUMN from_notification boolean NOT NULL DEFAULT false;
