-- no-transaction
-- A failed concurrent build can leave an invalid index. Before retrying this
-- migration, drop only that invalid index concurrently, following the DB runbook.
CREATE INDEX CONCURRENTLY email_projection_outbox_unparked_due
    ON public.email_projection_outbox
        (GREATEST(available_at, COALESCE(blocked_until, '-infinity'::timestamptz)), id)
    WHERE parked_at IS NULL;
