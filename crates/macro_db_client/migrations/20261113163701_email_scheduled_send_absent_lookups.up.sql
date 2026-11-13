SET LOCAL lock_timeout = '2s';

-- An uncertain Gmail send (a 5xx or a lost answer) is looked up by its
-- Message-ID before anything else happens to it. These count the lookups
-- that found no sent copy since the last submission, and how often a send
-- was submitted again after enough of them, so the worker resends only
-- once Gmail has repeatedly shown the message never went out, and only a
-- bounded number of times.
--
-- Constant defaults: adding the columns changes only the catalog, no rows
-- are rewritten. Workers released before this change ignore them.
ALTER TABLE email_scheduled_messages
    ADD COLUMN delivery_absent_lookups smallint NOT NULL DEFAULT 0,
    ADD COLUMN delivery_resends smallint NOT NULL DEFAULT 0;
