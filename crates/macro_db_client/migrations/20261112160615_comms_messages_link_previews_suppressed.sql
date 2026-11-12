-- The sender removed the link previews from their message: it shows none from
-- then on, whatever links a later edit adds.
-- Adding a column with a constant default rewrites nothing, but takes a brief
-- exclusive lock on comms_messages; fail fast instead of queueing writes
-- behind a long transaction.
SET LOCAL lock_timeout = '2s';

ALTER TABLE public.comms_messages
    ADD COLUMN link_previews_suppressed boolean DEFAULT false NOT NULL;
