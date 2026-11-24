-- Claims of a projection entry in a row that ended without recording an
-- outcome: the worker holding the lease stopped, and the next claim found the
-- lease still set. The projection gives the entry up after a few, as message
-- reconciliation does a message. The default is a constant, so no row is
-- rewritten.
SET LOCAL lock_timeout = '5s';
ALTER TABLE email_projection_outbox
    ADD COLUMN unfinished_claims integer NOT NULL DEFAULT 0;
