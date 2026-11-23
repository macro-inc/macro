-- no-transaction
-- An interrupted build can leave an INVALID index: inspect pg_index and drop
-- only that invalid index concurrently before retrying this migration.
CREATE INDEX CONCURRENTLY email_projection_outbox_parked_link
    ON public.email_projection_outbox (link_id, seq NULLS FIRST, id)
    WHERE parked_at IS NOT NULL;
