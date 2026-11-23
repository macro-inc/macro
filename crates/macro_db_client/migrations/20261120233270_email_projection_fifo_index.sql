-- no-transaction
-- A failed concurrent build can leave an invalid index. Before retrying this
-- migration, drop only that invalid index concurrently, following the DB runbook.
CREATE INDEX CONCURRENTLY email_projection_outbox_link_fifo
    ON public.email_projection_outbox (link_id, seq NULLS FIRST, id);
