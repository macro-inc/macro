-- Claims of a message's revision in a row that ended without recording an
-- outcome: the worker holding the lease stopped, and the next claim found it
-- expired. Reconciliation abandons the message after a few, as it does a
-- message that keeps failing. claimed_revision is the revision the last claim
-- read, so a new change starts the count over.
SET LOCAL lock_timeout = '5s';
ALTER TABLE email_message_reconciliation
    ADD COLUMN unfinished_claims integer NOT NULL DEFAULT 0,
    ADD COLUMN claimed_revision bigint NOT NULL DEFAULT 0;
