-- Focus rule facts the list reads, and the rule version that wrote them.
--   rule_version: the worker re-decides rows from an older version out of their
--     stored scores, without calling the classifier. Existing rows read 0.
--   pinned: key mail that stays in Focus even when the thread is not signal.
--   awaiting_reply: the owner sent the classified message and expects an
--     answer. The list applies the age threshold when it reads.
-- Constant defaults only change the catalog, so old writers keep working.
SET LOCAL lock_timeout = '5s';

ALTER TABLE email_thread_focus
    ADD COLUMN rule_version SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN awaiting_reply BOOLEAN NOT NULL DEFAULT FALSE;
